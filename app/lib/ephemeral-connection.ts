import { Connection } from "@solana/web3.js";
import {
  getAuthToken,
  verifyTeeRpcIntegrity,
} from "@magicblock-labs/ephemeral-rollups-sdk";

import { borrowLog } from "@/lib/haven-borrow-debug";
import { isPublicDevnetEphemeralRollup } from "@/lib/haven-config";

type Cache = { baseUrl: string; token: string; expiresAtMs: number };

let cache: Cache | null = null;

function stripTrailingSlash(url: string): string {
  return url.replace(/\?.*$/, "").replace(/\/+$/, "");
}

/** Private PER / TEE rollup hostnames (Intel TDX attestation via SDK). */
function isTeeMagicBlockHost(http: string): boolean {
  try {
    const h = new URL(http).hostname.toLowerCase();
    return h === "tee.magicblock.app" || h.endsWith(".tee.magicblock.app");
  } catch {
    return /\btee\.magicblock\.app\b/i.test(http);
  }
}

/**
 * Authenticated Connection to the private TEE rollup (used under the hood for borrow steps).
 */
export async function getAuthenticatedEphemeralConnection(
  ephemeralHttp: string,
  ephemeralWs: string,
  publicKey: import("@solana/web3.js").PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<Connection> {
  const authBase = stripTrailingSlash(ephemeralHttp);
  const now = Date.now();
  if (
    cache &&
    cache.baseUrl === authBase &&
    now < cache.expiresAtMs - 60_000
  ) {
    borrowLog("ER auth: using cached token", {
      baseUrl: authBase,
      expiresInSec: Math.round((cache.expiresAtMs - now) / 1000),
    });
    const urlWithToken = `${authBase}?token=${cache.token}`;
    const wsBase = stripTrailingSlash(ephemeralWs);
    const wsWithToken = `${wsBase}?token=${cache.token}`;
    return new Connection(urlWithToken, {
      wsEndpoint: wsWithToken,
      commitment: "processed",
    });
  }

  borrowLog("ER auth: fetching new token (sign message)", {
    authBase,
  });
  const auth = await getAuthToken(authBase, publicKey, signMessage);
  borrowLog("ER auth: token received", {
    authBase,
    expiresAtMs: auth.expiresAt,
  });
  const expiresAtMs =
    auth.expiresAt > 1_000_000_000_000
      ? auth.expiresAt
      : auth.expiresAt * 1000;
  cache = {
    baseUrl: authBase,
    token: auth.token,
    expiresAtMs,
  };
  const urlWithToken = `${authBase}?token=${auth.token}`;
  const wsBase = stripTrailingSlash(ephemeralWs);
  const wsWithToken = `${wsBase}?token=${auth.token}`;
  return new Connection(urlWithToken, {
    wsEndpoint: wsWithToken,
    commitment: "processed",
  });
}

/** Local ER does not need auth token challenge flow. */
export function isLocalEphemeral(http: string): boolean {
  return http.includes("localhost") || http.includes("127.0.0.1");
}

export async function getEphemeralConnectionForBorrow(
  ephemeralHttp: string,
  ephemeralWs: string,
  publicKey: import("@solana/web3.js").PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
): Promise<Connection> {
  if (isLocalEphemeral(ephemeralHttp)) {
    borrowLog("ER connection: local (no auth token)", {
      http: ephemeralHttp,
    });
    return new Connection(ephemeralHttp, {
      wsEndpoint: ephemeralWs,
      commitment: "processed",
    });
  }
  if (isTeeMagicBlockHost(ephemeralHttp)) {
    const baseHttp = stripTrailingSlash(ephemeralHttp);
    borrowLog("ER connection: TEE — verifying RPC integrity (TDX quote)", {
      http: redactUrl(baseHttp),
    });
    const ok = await verifyTeeRpcIntegrity(baseHttp);
    if (!ok) {
      throw new Error(
        "TEE RPC integrity check failed. Refusing to connect to this PER endpoint.",
      );
    }
    return getAuthenticatedEphemeralConnection(
      ephemeralHttp,
      ephemeralWs,
      publicKey,
      signMessage,
    );
  }
  if (isPublicDevnetEphemeralRollup(ephemeralHttp)) {
    borrowLog("ER connection: public devnet ER (no auth token)", {
      http: ephemeralHttp,
      ws: ephemeralWs,
    });
    return new Connection(ephemeralHttp, {
      wsEndpoint: ephemeralWs,
      commitment: "processed",
    });
  }
  borrowLog("ER connection: generic host → auth token flow", {
    http: redactUrl(ephemeralHttp),
    ws: redactUrl(ephemeralWs),
  });
  return getAuthenticatedEphemeralConnection(
    ephemeralHttp,
    ephemeralWs,
    publicKey,
    signMessage,
  );
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    return u.toString();
  } catch {
    return url.replace(/\?.*$/, "");
  }
}

/** Call after a failed rollup borrow so the next attempt re-auths (fresh token). */
export function clearEphemeralAuthCache(): void {
  borrowLog("ER auth: cache cleared");
  cache = null;
}
