/**
 * MagicBlock Private Payments API client (server-only).
 * @see https://payments.magicblock.app/reference
 *
 * Desk app: wallet-signed flows only — no treasury keypair helpers.
 */

import type { UnsignedTxResponse } from "@/lib/per-types";

export type { UnsignedTxResponse } from "@/lib/per-types";

export type PerCluster = "devnet" | "mainnet";

export const DEFAULT_DEVNET_USDC =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

function readEnv(name: string, fallback?: string): string {
  const v = process.env[name]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env: ${name}`);
}

export function getPerApiBase(): string {
  return readEnv("PER_API_BASE", "https://payments.magicblock.app").replace(
    /\/+$/,
    "",
  );
}

export function getPerCluster(): PerCluster {
  const c = readEnv("PER_CLUSTER", "devnet");
  if (c !== "devnet" && c !== "mainnet") {
    throw new Error(`PER_CLUSTER must be devnet or mainnet, got: ${c}`);
  }
  return c;
}

export function getPerMint(): string {
  return readEnv("PER_MINT", DEFAULT_DEVNET_USDC);
}

export async function perFetchJson<T>(
  pathSuffix: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${getPerApiBase()}${pathSuffix.startsWith("/") ? "" : "/"}${pathSuffix}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Non-JSON response ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const err = body as { error?: { message?: string; code?: string } };
    const msg =
      err?.error?.message ?? err?.error?.code ?? text.slice(0, 800);
    throw new Error(`PER API HTTP ${res.status}: ${msg}`);
  }
  return body as T;
}

export function queryString(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}
