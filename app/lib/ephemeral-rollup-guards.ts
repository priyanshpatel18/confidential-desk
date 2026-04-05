/**
 * Cluster vs Ephemeral Rollup URL checks and permission polling after base-layer delegation.
 */
import { PublicKey } from "@solana/web3.js";
import { waitUntilPermissionActive } from "@magicblock-labs/ephemeral-rollups-sdk";

import {
  borrowLog,
  isBorrowDebugEnabled,
  redactRpcUrl,
} from "@/lib/haven-borrow-debug";
import {
  getSolanaCluster,
  isPublicDevnetEphemeralRollup,
  isStrictTeeEphemeralRollup,
} from "@/lib/haven-config";

const DEFAULT_PERMISSION_WAIT_MS = 120_000;
const PERMISSION_POST_CONFIRM_MS = 2_000;
/** Extra delay when we skip SDK HTTP `/permission` (hosted devnet ER is JSON-RPC-only). */
const PUBLIC_DEVNET_PERMISSION_EXTRA_MS = 2_500;

function permissionWaitTimeoutMs(): number {
  const raw = process.env.NEXT_PUBLIC_PERMISSION_WAIT_MS?.trim();
  if (!raw) return DEFAULT_PERMISSION_WAIT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 10_000 ? n : DEFAULT_PERMISSION_WAIT_MS;
}

export function assertEphemeralRollupMatchesCluster(ephemeralHttp: string): void {
  const cluster = getSolanaCluster();
  const h = ephemeralHttp.toLowerCase();
  const devnetHosted =
    h.includes("devnet.magicblock.app") || h.includes("devnet-as.magicblock.app");
  if (cluster === "devnet" && isStrictTeeEphemeralRollup(ephemeralHttp)) {
    throw new Error(
      "Solana devnet + TEE ER do not pair: base RPC is devnet but tee.magicblock.app is mainnet-style PER, so delegation never syncs. " +
        "Use NEXT_PUBLIC_EPHEMERAL_HTTP=https://devnet.magicblock.app and NEXT_PUBLIC_EPHEMERAL_WS=wss://devnet.magicblock.app (see .env.example).",
    );
  }
  if (cluster === "mainnet-beta" && devnetHosted) {
    throw new Error(
      "Solana mainnet + devnet MagicBlock ER do not pair. Use a mainnet PER URL (often https://tee.magicblock.app) or switch the app to devnet.",
    );
  }
  if (isBorrowDebugEnabled()) {
    borrowLog("[desk] ER/cluster pairing OK", {
      cluster,
      ephemeralHttp,
      devnetHostedEr: devnetHosted,
      teeEr: isStrictTeeEphemeralRollup(ephemeralHttp),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitRollupPermissionOrThrow(
  erRpcEndpoint: string,
  permissionedAccountPda: PublicKey,
  ephemHttpForHint: string,
): Promise<void> {
  const skipHttpPermissionPoll = isPublicDevnetEphemeralRollup(ephemHttpForHint);
  const delayMs = skipHttpPermissionPoll
    ? PERMISSION_POST_CONFIRM_MS + PUBLIC_DEVNET_PERMISSION_EXTRA_MS
    : PERMISSION_POST_CONFIRM_MS;

  if (isBorrowDebugEnabled()) {
    borrowLog("[desk] permission wait: sleeping after base confirm", {
      ms: delayMs,
      skipHttpPermissionPoll,
    });
  }
  await sleep(delayMs);

  // Hosted devnet ER (`devnet.magicblock.app`) answers every HTTP path with JSON-RPC.
  // GET `/permission?pubkey=…` returns `{ jsonrpc, error }` (200 OK), so the SDK never
  // sees `authorizedUsers` and would spin until timeout. Skip that poll; rely on delay + PER tx.
  if (skipHttpPermissionPoll) {
    if (isBorrowDebugEnabled()) {
      borrowLog(
        "[desk] permission wait: skipped SDK HTTP poll (public devnet ER has no REST /permission)",
        { permissionedAccount: permissionedAccountPda.toBase58() },
      );
    }
    return;
  }

  const timeout = permissionWaitTimeoutMs();
  if (isBorrowDebugEnabled()) {
    borrowLog("[desk] permission wait: polling SDK", {
      permissionRpc: redactRpcUrl(erRpcEndpoint),
      permissionedAccount: permissionedAccountPda.toBase58(),
      timeoutMs: timeout,
      erHttpHint: ephemHttpForHint,
      cluster: getSolanaCluster(),
    });
  }
  const t0 = Date.now();
  const ok = await waitUntilPermissionActive(
    erRpcEndpoint,
    permissionedAccountPda,
    timeout,
  );
  if (isBorrowDebugEnabled()) {
    borrowLog("[desk] permission wait: poll finished", {
      ok,
      elapsedMs: Date.now() - t0,
    });
  }
  if (!ok) {
    const cluster = getSolanaCluster();
    throw new Error(
      `Timed out (${Math.round(timeout / 1000)}s) waiting for the rollup to index delegation for ${permissionedAccountPda.toBase58().slice(0, 8)}… ` +
        `Solana cluster: ${cluster}. ER: ${ephemHttpForHint}. ` +
        `Confirm NEXT_PUBLIC_EPHEMERAL_* matches that cluster, try NEXT_PUBLIC_PERMISSION_WAIT_MS=180000, ` +
        `or set NEXT_PUBLIC_EPHEMERAL_VALIDATOR if MagicBlock docs specify one. For TEE, sign out and retry (fresh auth).`,
    );
  }
}
