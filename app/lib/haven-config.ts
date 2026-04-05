import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { PublicKey } from "@solana/web3.js";

import { borrowLog } from "@/lib/haven-borrow-debug";

const POOL_SEED = Buffer.from("pool");
const POSITION_SEED = Buffer.from("position");
const LP_MINT_SEED = Buffer.from("lp_mint");

/** Wrapped SOL: same mint address on devnet and mainnet. Collateral in the SOL/USDC pool. */
export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112",
);

/** Circle USDC on Solana mainnet. */
export const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

/**
 * Common devnet USDC mint (Circle test token).
 * Your Haven pool must be initialized with `WSOL_MINT` + this USDC (or your overrides).
 */
export const USDC_MINT_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

/**
 * Default hosted **devnet** ER (matches MagicBlock docs + `api.devnet.solana.com` pools).
 * Use `NEXT_PUBLIC_EPHEMERAL_*` to override (e.g. PER tee below).
 */
export const DEFAULT_EPHEMERAL_DEVNET_HTTP = "https://devnet.magicblock.app";
export const DEFAULT_EPHEMERAL_DEVNET_WS = "wss://devnet.magicblock.app";

/** PER / private TEE rollup — pair with `tee.magicblock.app` only. */
export const DEFAULT_EPHEMERAL_TEE_HTTP = "https://tee.magicblock.app";
export const DEFAULT_EPHEMERAL_TEE_WS = "wss://tee.magicblock.app";

/** @deprecated Use cluster-aware `ephemeralEndpoints()` or explicit env. */
export const DEFAULT_EPHEMERAL_HTTP = DEFAULT_EPHEMERAL_TEE_HTTP;
/** @deprecated Use cluster-aware `ephemeralEndpoints()` or explicit env. */
export const DEFAULT_EPHEMERAL_WS = DEFAULT_EPHEMERAL_TEE_WS;

/** Local docker / `anchor test` ER validator. */
export const LOCAL_ER_VALIDATOR = new PublicKey(
  "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);

/** Same validator pubkey as Haven integration tests / RPS tee / `tee.magicblock.app`. */
export const DEFAULT_TEE_VALIDATOR = new PublicKey(
  "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA",
);

const DEFAULT_MAGIC_ROUTER_HTTP = "https://devnet-router.magicblock.app";
const DEFAULT_MAGIC_ROUTER_WS = "wss://devnet-router.magicblock.app";

export function inferWsFromHttp(http: string): string {
  if (http.startsWith("https://")) {
    return `wss://${http.slice("https://".length)}`;
  }
  if (http.startsWith("http://")) {
    return `ws://${http.slice("http://".length)}`;
  }
  return DEFAULT_EPHEMERAL_DEVNET_WS;
}

export type SolanaClusterId = "devnet" | "mainnet-beta";

/**
 * `NEXT_PUBLIC_SOLANA_CLUSTER`: `devnet` | `mainnet-beta`.
 * If unset, inferred from `NEXT_PUBLIC_SOLANA_RPC` containing `devnet`, else defaults to devnet.
 */
export function getSolanaCluster(): SolanaClusterId {
  const c = process.env.NEXT_PUBLIC_SOLANA_CLUSTER?.trim().toLowerCase();
  if (c === "mainnet" || c === "mainnet-beta") return "mainnet-beta";
  if (c === "devnet") return "devnet";
  const rpc = (process.env.NEXT_PUBLIC_SOLANA_RPC ?? "").toLowerCase();
  if (rpc.includes("devnet")) return "devnet";
  return "devnet";
}

function defaultUsdcMintForCluster(cluster: SolanaClusterId): PublicKey {
  return cluster === "mainnet-beta" ? USDC_MINT_MAINNET : USDC_MINT_DEVNET;
}

/** Collateral mint: env override, else wrapped SOL. */
export function getCollateralMint(): PublicKey {
  const s = process.env.NEXT_PUBLIC_COLLATERAL_MINT?.trim();
  if (s) {
    try {
      return new PublicKey(s);
    } catch {
      /* fall through */
    }
  }
  return WSOL_MINT;
}

/** Borrow / lend asset mint: env override, else USDC for current cluster. */
export function getBorrowMint(): PublicKey {
  const s = process.env.NEXT_PUBLIC_BORROW_MINT?.trim();
  if (s) {
    try {
      return new PublicKey(s);
    } catch {
      /* fall through */
    }
  }
  return defaultUsdcMintForCluster(getSolanaCluster());
}

export function getProgramId(): PublicKey {
  const s = process.env.NEXT_PUBLIC_HAVEN_PROGRAM_ID?.trim();
  if (s) return new PublicKey(s);
  return new PublicKey("2zQzcy9obqDdEHVChbuc5exJZmUSSabUXkQ2MCKsHiKs");
}

export function derivePoolPda(
  programId: PublicKey,
  collateralMint: PublicKey,
  borrowMint: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [POOL_SEED, collateralMint.toBuffer(), borrowMint.toBuffer()],
    programId,
  );
  return pda;
}

export function deriveLpMintPda(
  programId: PublicKey,
  collateralMint: PublicKey,
  borrowMint: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [LP_MINT_SEED, collateralMint.toBuffer(), borrowMint.toBuffer()],
    programId,
  );
  return pda;
}

export function derivePositionPda(
  programId: PublicKey,
  pool: PublicKey,
  owner: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [POSITION_SEED, pool.toBuffer(), owner.toBuffer()],
    programId,
  );
  return pda;
}

/**
 * `tee.magicblock.app` uses strict writable rules: only delegated / ephemeral-SPL accounts
 * may be written. Haven `borrow` must mutate the pool PDA, borrow vault, and user USDC ATA,
 * so rollup simulation fails with `InvalidWritableAccount`.
 */
export function isStrictTeeEphemeralRollup(ephemeralHttp: string): boolean {
  try {
    return new URL(ephemeralHttp).hostname.toLowerCase() === "tee.magicblock.app";
  } catch {
    return /\btee\.magicblock\.app\b/i.test(ephemeralHttp);
  }
}

/**
 * Public hosted devnet ER is plain JSON-RPC (no token). It does not serve TEE-style
 * `/auth/challenge`, so the SDK `getAuthToken` flow never reaches `signMessage`.
 */
export function isPublicDevnetEphemeralRollup(http: string): boolean {
  try {
    const h = new URL(http).hostname.toLowerCase();
    return h === "devnet.magicblock.app" || h === "devnet-as.magicblock.app";
  } catch {
    return (
      /\bdevnet\.magicblock\.app\b/i.test(http) ||
      /\bdevnet-as\.magicblock\.app\b/i.test(http)
    );
  }
}

/** TEE-style ERs use `getAuthToken` + wallet signMessage; public devnet ER and localhost do not. */
export function ephemeralRollupNeedsSignMessageAuth(ephemeralHttp: string): boolean {
  if (isPublicDevnetEphemeralRollup(ephemeralHttp)) {
    return false;
  }
  try {
    const h = new URL(ephemeralHttp).hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1") {
      return false;
    }
  } catch {
    /* fall through */
  }
  if (/localhost|127\.0\.0\.1/i.test(ephemeralHttp)) {
    return false;
  }
  return true;
}

/**
 * Rollup HTTP + WS for borrow / repay / position.
 * When unset, **devnet** Solana cluster defaults to `devnet.magicblock.app` (hosted devnet ER);
 * **mainnet** defaults to PER tee. Override with `NEXT_PUBLIC_EPHEMERAL_HTTP` / `WS`.
 */
export function ephemeralEndpoints(): { http: string; ws: string } {
  const envHttp = process.env.NEXT_PUBLIC_EPHEMERAL_HTTP?.trim();
  if (envHttp) {
    const http = envHttp.replace(/\/+$/, "");
    const envWs = process.env.NEXT_PUBLIC_EPHEMERAL_WS?.trim();
    const ws = (envWs || inferWsFromHttp(http)).replace(/\/+$/, "");
    return { http, ws };
  }
  const cluster = getSolanaCluster();
  if (cluster === "mainnet-beta") {
    return {
      http: DEFAULT_EPHEMERAL_TEE_HTTP.replace(/\/+$/, ""),
      ws: DEFAULT_EPHEMERAL_TEE_WS.replace(/\/+$/, ""),
    };
  }
  return {
    http: DEFAULT_EPHEMERAL_DEVNET_HTTP.replace(/\/+$/, ""),
    ws: DEFAULT_EPHEMERAL_DEVNET_WS.replace(/\/+$/, ""),
  };
}

export function magicRouterEndpoints(): { http: string; ws: string } {
  const http = (
    process.env.NEXT_PUBLIC_MAGIC_ROUTER_HTTP?.trim() || DEFAULT_MAGIC_ROUTER_HTTP
  ).replace(/\/+$/, "");
  const ws = (
    process.env.NEXT_PUBLIC_MAGIC_ROUTER_WS?.trim() || DEFAULT_MAGIC_ROUTER_WS
  ).replace(/\/+$/, "");
  return { http, ws };
}

/**
 * Validator account passed to `delegate_permission` / `delegate_position`.
 * - Env override wins.
 * - Localhost ER → fixed local validator.
 * - `tee.magicblock.app` → fixed PER validator (same as RPS tests).
 * - Other hosted ER (e.g. devnet.magicblock.app) → `ConnectionMagicRouter.getClosestValidator()`.
 */
export async function resolveDelegateValidatorPk(
  ephemeralHttp: string,
): Promise<PublicKey> {
  const fromEnv = process.env.NEXT_PUBLIC_EPHEMERAL_VALIDATOR?.trim();
  if (fromEnv) {
    const pk = new PublicKey(fromEnv);
    borrowLog("[desk] delegate validator (env)", {
      validator: pk.toBase58(),
    });
    return pk;
  }
  const h = ephemeralHttp.toLowerCase();
  if (h.includes("localhost") || h.includes("127.0.0.1")) {
    borrowLog("[desk] delegate validator (local ER)", {
      validator: LOCAL_ER_VALIDATOR.toBase58(),
    });
    return LOCAL_ER_VALIDATOR;
  }
  if (h.includes("tee.magicblock.app")) {
    borrowLog("[desk] delegate validator (TEE default)", {
      validator: DEFAULT_TEE_VALIDATOR.toBase58(),
    });
    return DEFAULT_TEE_VALIDATOR;
  }
  const { http, ws } = magicRouterEndpoints();
  borrowLog("[desk] delegate validator (Magic router)", {
    routerHttp: http,
  });
  const router = new ConnectionMagicRouter(http, { wsEndpoint: ws });
  const { identity } = await router.getClosestValidator();
  if (!identity) {
    throw new Error(
      "Magic router did not return a validator identity. Set NEXT_PUBLIC_EPHEMERAL_VALIDATOR in .env.",
    );
  }
  const pk = new PublicKey(identity);
  borrowLog("[desk] delegate validator (router result)", {
    validator: pk.toBase58(),
  });
  return pk;
}

/** Sync default (TEE) when you cannot await router resolution — prefer `resolveDelegateValidatorPk` for borrow. */
export function ephemeralValidator(): PublicKey {
  const fromEnv = process.env.NEXT_PUBLIC_EPHEMERAL_VALIDATOR?.trim();
  if (fromEnv) return new PublicKey(fromEnv);
  return DEFAULT_TEE_VALIDATOR;
}

/**
 * SOL/USD feed — canonical implementation lives in `lib/realtime-price-tracker/`
 * (aligned with the `realtime-price-tracker` repo).
 */
export {
  getRealtimeSolFeedConfig as getSolPriceFeedConfig,
  REALTIME_TRACKER_DEFAULT_ACCOUNT as DEFAULT_SOL_PRICE_FEED_ACCOUNT,
  REALTIME_TRACKER_DEFAULT_RPC as DEFAULT_SOL_PRICE_FEED_RPC,
} from "./realtime-price-tracker";

/** Human labels for the fixed SOL / USDC product surface. */
export function pairLabels() {
  return {
    collateral: "SOL",
    collateralDetail:
      "Uses wrapped SOL (WSOL) in your wallet; same value as SOL.",
    borrow: "USDC",
    lend: "USDC",
    pairLine: "SOL collateral, USDC pool",
  };
}

export function clusterLabel(): string {
  return getSolanaCluster() === "mainnet-beta" ? "Mainnet" : "Devnet";
}

/** Always configured: mints default to WSOL + cluster USDC. */
export function isPoolConfigured(): boolean {
  return true;
}
