import { getAuthToken } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Connection,
  PublicKey,
  SendTransactionError,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import type { UnsignedTxResponse } from "@/lib/per-types";

export type PerWalletLike = {
  publicKey: PublicKey | null;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
};

export type PerTransactionMergeOpts = {
  connection: Connection;
  prepend?: TransactionInstruction[];
  append?: TransactionInstruction[];
};

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

  const basePerTx = Transaction.from(
    Buffer.from(unsigned.transactionBase64, "base64"),
  );
  const { blockhash, lastValidBlockHeight } =
    await merge.connection.getLatestBlockhash("confirmed");
  const feePayer = basePerTx.feePayer ?? wallet.publicKey;
  const merged = new Transaction({
    feePayer,
    recentBlockhash: blockhash,
  });
  for (const ix of merge.prepend ?? []) merged.add(ix);
  for (const ix of basePerTx.instructions) merged.add(ix);
  for (const ix of merge.append ?? []) merged.add(ix);

  const signed = await wallet.signTransaction(merged);

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
    throw e;
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

  const tx = Transaction.from(
    Buffer.from(unsigned.transactionBase64, "base64"),
  );
  const signed = await wallet.signTransaction(tx);

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
    throw e;
  }
}
