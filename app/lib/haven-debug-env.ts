/**
 * Env / cluster snapshot for console debugging (avoids circular imports with haven-borrow-debug).
 */
import {
  borrowLog,
  borrowWarn,
  isBorrowDebugEnabled,
  redactRpcUrl,
} from "@/lib/haven-borrow-debug";
import { ephemeralEndpoints, getSolanaCluster } from "@/lib/haven-config";

export function logDebugEnvSnapshot(reason: string): void {
  if (!isBorrowDebugEnabled()) return;
  try {
    const { http, ws } = ephemeralEndpoints();
    borrowLog("[debug] env snapshot", {
      reason,
      nodeEnv: process.env.NODE_ENV,
      solanaCluster: getSolanaCluster(),
      solanaRpc: redactRpcUrl(
        process.env.NEXT_PUBLIC_SOLANA_RPC?.trim() || "(default wallet RPC)",
      ),
      ephemeralHttp: http,
      ephemeralWs: ws,
      permissionWaitMs: process.env.NEXT_PUBLIC_PERMISSION_WAIT_MS ?? "(default 120000)",
      ephemeralValidatorSet: Boolean(
        process.env.NEXT_PUBLIC_EPHEMERAL_VALIDATOR?.trim(),
      ),
      deskProgramOverride: Boolean(
        process.env.NEXT_PUBLIC_CONFIDENTIAL_DESK_PROGRAM_ID?.trim(),
      ),
    });
  } catch (e) {
    borrowWarn("[debug] env snapshot failed", e);
  }
}
