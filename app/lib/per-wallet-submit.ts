import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import type { UnsignedTxResponse } from "@/lib/per-types";
import { parsePerUnsignedWire } from "@/lib/per-tx-wire";

export type PerWalletLike = {
  publicKey: PublicKey | null;
  signTransaction?: (
    tx: Transaction | VersionedTransaction,
  ) => Promise<Transaction | VersionedTransaction>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
};

export type PerTransactionMergeOpts = {
  connection: Connection;
  prepend?: TransactionInstruction[];
  append?: TransactionInstruction[];
};

function normalizeSubmitError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "object" && e !== null) {
    const o = e as Record<string, unknown>;
    const msg =
      typeof o.message === "string"
        ? o.message
        : typeof o.msg === "string"
          ? o.msg
          : (() => {
              try {
                return JSON.stringify(e);
              } catch {
                return String(e);
              }
            })();
    return new Error(msg);
  }
  return new Error(String(e));
}

async function fetchLookupTableAccounts(
  connection: Connection,
  message: VersionedTransaction["message"],
): Promise<AddressLookupTableAccount[]> {
  if (message.version !== 0) return [];
  const lookups = message.addressTableLookups;
  if (!lookups.length) return [];
  const out: AddressLookupTableAccount[] = [];
  for (const l of lookups) {
    const res = await connection.getAddressLookupTable(l.accountKey);
    if (!res.value) {
      throw new Error(
        `Address lookup table account missing: ${l.accountKey.toBase58()}`,
      );
    }
    out.push(
      new AddressLookupTableAccount({
        key: l.accountKey,
        state: res.value.state,
      }),
    );
  }
  return out;
}

/**
 * Deserialize PER unsigned tx, prepend/append SPL instructions, refresh blockhash,
 * sign once, and submit (same layer as `submitPreparedPerTransaction`).
 * Prepend/append must be valid on the **same** cluster as `unsigned.sendTo`
 * (do not mix base SPL ixs with `sendTo: "ephemeral"`).
 */
export async function submitPerTransactionMerged(
  unsigned: UnsignedTxResponse,
  wallet: PerWalletLike,
  baseRpc: string,
  ephemeralRpc: string,
  useTeeAuth: boolean,
  merge: PerTransactionMergeOpts,
): Promise<string> {
  if (!wallet.publicKey) {
    throw new Error("Connect a wallet first.");
  }
  if (!wallet.signTransaction) {
    throw new Error("This wallet cannot sign transactions.");
  }

  const parsed = parsePerUnsignedWire(unsigned.transactionBase64);
  const { blockhash, lastValidBlockHeight } =
    await merge.connection.getLatestBlockhash("confirmed");

  const prepend = merge.prepend ?? [];
  const append = merge.append ?? [];

  let signedLegacy: Transaction | undefined;
  let signedV0: VersionedTransaction | undefined;

  try {
    if (parsed.kind === "legacy") {
      const basePerTx = parsed.tx;
      const feePayer = basePerTx.feePayer ?? wallet.publicKey;
      const merged = new Transaction({
        feePayer,
        recentBlockhash: blockhash,
      });
      for (const ix of prepend) merged.add(ix);
      for (const ix of basePerTx.instructions) merged.add(ix);
      for (const ix of append) merged.add(ix);
      const signed = await wallet.signTransaction(merged);
      if (!(signed instanceof Transaction)) {
        throw new Error("Wallet returned unexpected transaction type (expected legacy).");
      }
      signedLegacy = signed;
    } else {
      const vtx = parsed.tx;
      const altAccounts = await fetchLookupTableAccounts(
        merge.connection,
        vtx.message,
      );
      const decompiled = TransactionMessage.decompile(vtx.message, {
        addressLookupTableAccounts: altAccounts,
      });
      const feePayer = decompiled.payerKey;
      const ixs: TransactionInstruction[] = [
        ...prepend,
        ...decompiled.instructions,
        ...append,
      ];
      const msg = new TransactionMessage({
        payerKey: feePayer,
        recentBlockhash: blockhash,
        instructions: ixs,
      });
      const v0msg = msg.compileToV0Message(altAccounts);
      const mergedV = new VersionedTransaction(v0msg);
      const signed = await wallet.signTransaction(mergedV);
      if (!(signed instanceof VersionedTransaction)) {
        throw new Error("Wallet returned unexpected transaction type (expected v0).");
      }
      signedV0 = signed;
    }
  } catch (e) {
    throw normalizeSubmitError(e);
  }

  const baseConn = new Connection(baseRpc, { commitment: "confirmed" });
  const ephemeralHttp = ephemeralRpc.replace(/\/+$/, "");
  let ephemeralConn: Connection;
  if (useTeeAuth) {
    if (!wallet.signMessage) {
      throw new Error(
        "TEE ephemeral RPC requires signMessage (enable NEXT_PUBLIC_PER_USE_TEE_AUTH only if your wallet supports it).",
      );
    }
    const auth = await getAuthToken(
      ephemeralHttp,
      wallet.publicKey,
      (message: Uint8Array) => wallet.signMessage!(message),
    );
    ephemeralConn = new Connection(`${ephemeralHttp}?token=${auth.token}`, {
      commitment: "confirmed",
    });
  } else {
    ephemeralConn = new Connection(ephemeralHttp, { commitment: "confirmed" });
  }

  const conn = unsigned.sendTo === "ephemeral" ? ephemeralConn : baseConn;
  try {
    const wire =
      signedLegacy?.serialize() ?? signedV0!.serialize();
    const sig = await conn.sendRawTransaction(wire, {
      skipPreflight: true,
      maxRetries: 3,
    });
    await conn.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    return sig;
  } catch (e) {
    if (e instanceof SendTransactionError) {
      const logs = await e.getLogs(conn);
      throw new Error(`${e.message}\n${logs?.join("\n") ?? ""}`);
    }
    throw normalizeSubmitError(e);
  }
}

export async function submitPreparedPerTransaction(
  unsigned: UnsignedTxResponse,
  wallet: PerWalletLike,
  baseRpc: string,
  ephemeralRpc: string,
  useTeeAuth: boolean,
): Promise<string> {
  if (!wallet.publicKey) {
    throw new Error("Connect a wallet first.");
  }
  if (!wallet.signTransaction) {
    throw new Error("This wallet cannot sign transactions.");
  }

  const parsed = parsePerUnsignedWire(unsigned.transactionBase64);
  let signed: Transaction | VersionedTransaction;
  try {
    signed = await wallet.signTransaction(parsed.tx);
  } catch (e) {
    throw normalizeSubmitError(e);
  }

  const baseConn = new Connection(baseRpc, { commitment: "confirmed" });
  const ephemeralHttp = ephemeralRpc.replace(/\/+$/, "");
  let ephemeralConn: Connection;
  if (useTeeAuth) {
    if (!wallet.signMessage) {
      throw new Error(
        "TEE ephemeral RPC requires signMessage (enable NEXT_PUBLIC_PER_USE_TEE_AUTH only if your wallet supports it).",
      );
    }
    const auth = await getAuthToken(
      ephemeralHttp,
      wallet.publicKey,
      (message: Uint8Array) => wallet.signMessage!(message),
    );
    ephemeralConn = new Connection(`${ephemeralHttp}?token=${auth.token}`, {
      commitment: "confirmed",
    });
  } else {
    ephemeralConn = new Connection(ephemeralHttp, { commitment: "confirmed" });
  }

  const conn = unsigned.sendTo === "ephemeral" ? ephemeralConn : baseConn;
  try {
    const sig = await conn.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
      maxRetries: 3,
    });
    const latest = await conn.getLatestBlockhash("confirmed");
    await conn.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    return sig;
  } catch (e) {
    if (e instanceof SendTransactionError) {
      const logs = await e.getLogs(conn);
      throw new Error(`${e.message}\n${logs?.join("\n") ?? ""}`);
    }
    throw normalizeSubmitError(e);
  }
}
