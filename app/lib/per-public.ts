/** Client-safe RPC / flags (NEXT_PUBLIC_*). */

import { inferWsFromHttp, ephemeralEndpoints } from "@/lib/haven-config";

export function getPublicBaseRpc(): string {
  return (
    process.env.NEXT_PUBLIC_PER_BASE_RPC?.trim() ||
    process.env.NEXT_PUBLIC_SOLANA_RPC?.trim() ||
    "https://api.devnet.solana.com"
  );
}

export function getPublicEphemeralRpc(): string {
  const per = process.env.NEXT_PUBLIC_PER_EPHEMERAL_RPC?.trim();
  if (per) return per.replace(/\/+$/, "");
  const legacy = process.env.NEXT_PUBLIC_EPHEMERAL_HTTP?.trim();
  if (legacy) return legacy.replace(/\/+$/, "");
  return ephemeralEndpoints().http.replace(/\/+$/, "");
}

export function getPublicEphemeralWs(): string {
  const ws = process.env.NEXT_PUBLIC_EPHEMERAL_WS?.trim();
  if (ws) return ws.replace(/\/+$/, "");
  return inferWsFromHttp(getPublicEphemeralRpc());
}

export function getPublicUseTeeAuth(): boolean {
  return process.env.NEXT_PUBLIC_PER_USE_TEE_AUTH === "1";
}

export function explorerTxUrl(signature: string): string {
  const cluster =
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER === "mainnet-beta"
      ? "mainnet"
      : "devnet";
  return `https://solscan.io/tx/${signature}?cluster=${cluster}`;
}
