import {
  borrowError,
  borrowLog,
  borrowLogError,
  borrowWarn,
  redactRpcUrl,
} from "@/lib/haven-borrow-debug";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { Connection, Transaction } from "@solana/web3.js";

const ER_COMMITMENT = "processed" as const;

export type ErConfirmStrategy = {
  blockhash: string;
  lastValidBlockHeight: number;
};

export function isUserRejectedError(e: unknown): boolean {
  if (typeof e === "object" && e !== null && "code" in e) {
    if ((e as { code?: number }).code === 4001) {
      return true;
    }
  }
  if (e instanceof Error) {
    const m = e.message.toLowerCase();
    return (
      m.includes("reject") ||
      m.includes("denied") ||
      m.includes("cancel") ||
      m.includes("user rejected")
    );
  }
  return false;
}

export async function confirmErTransactionSucceeded(
  connection: Connection,
  signature: string,
  context: string,
  strategy?: ErConfirmStrategy,
): Promise<void> {
  borrowLog("confirmEr: start", {
    context,
    signature,
    rpc: redactRpcUrl(connection.rpcEndpoint),
    hasStrategy: Boolean(strategy),
  });
  try {
    if (strategy) {
      await connection.confirmTransaction(
        {
          signature,
          blockhash: strategy.blockhash,
          lastValidBlockHeight: strategy.lastValidBlockHeight,
        },
        ER_COMMITMENT,
      );
    } else {
      await connection.confirmTransaction(signature, ER_COMMITMENT);
    }
  } catch (ce) {
    borrowLogError("confirmEr: confirmTransaction threw", ce);
    throw ce;
  }
  for (let attempt = 0; attempt < 55; attempt++) {
    const res = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const st = res.value[0];
    if (st == null) {
      if (attempt === 0 || attempt % 10 === 0) {
        borrowWarn("confirmEr: signature status still null", {
          signature,
          attempt: attempt + 1,
        });
      }
      await new Promise((r) => setTimeout(r, 350));
      continue;
    }
    if (st.err) {
      borrowError("confirmEr: on-chain err (signature status)", {
        signature,
        err: st.err,
      });
      throw new Error(
        `${context} failed on-chain: ${JSON.stringify(st.err)}`,
      );
    }
    borrowLog("confirmEr: success (signature status)", {
      signature,
      attempts: attempt + 1,
    });
    return;
  }
  borrowError("confirmEr: timeout no signature status", { signature, context });
  throw new Error(
    `${context}: could not verify ${signature} (rollup RPC returned no signature status).`,
  );
}

/**
 * Send a transaction to the Ephemeral Rollup RPC. Use only for PER-eligible desk
 * instructions (`desk-rpc-policy`); base-only flows must use `createDeskProgram` + base `Connection`.
 */
export async function sendSignedEphemeralTx(
  erConnection: Connection,
  wallet: AnchorWallet,
  tx: Transaction,
  label: string,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await erConnection.getLatestBlockhash(ER_COMMITMENT);
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = wallet.publicKey;

  const unsignedLen = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
  borrowLog("sendErTx: before sign", {
    label,
    rpc: redactRpcUrl(erConnection.rpcEndpoint),
    instructions: tx.instructions.length,
    unsignedWireBytes: unsignedLen,
  });
  const signed = await wallet.signTransaction(tx);
  const signedLen = signed.serialize().length;
  if (signedLen > 1232) {
    borrowLogError("sendErTx: signed wire exceeds legacy limit", {
      label,
      signedLen,
    });
    throw new Error(`Transaction too large: ${signedLen} > 1232 (${label}).`);
  }
  const sig = await erConnection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  borrowLog("sendErTx: submitted", { label, signature: sig });
  await confirmErTransactionSucceeded(erConnection, sig, label, {
    blockhash,
    lastValidBlockHeight,
  });
  return sig;
}
