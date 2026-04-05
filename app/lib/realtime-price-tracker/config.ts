import { PublicKey } from "@solana/web3.js";

/**
 * Defaults match `realtime-price-tracker/components/price-tracker.tsx` (hardcoded there).
 * Override with NEXT_PUBLIC_SOL_PRICE_FEED_RPC / NEXT_PUBLIC_SOL_PRICE_FEED_ACCOUNT.
 */
export const REALTIME_TRACKER_DEFAULT_RPC = "https://devnet.magicblock.app";
export const REALTIME_TRACKER_DEFAULT_ACCOUNT = new PublicKey(
  "ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu",
);

export function getRealtimeSolFeedConfig(): {
  rpc: string;
  account: PublicKey;
} {
  const rpc =
    process.env.NEXT_PUBLIC_SOL_PRICE_FEED_RPC?.trim() ||
    REALTIME_TRACKER_DEFAULT_RPC;
  const s = process.env.NEXT_PUBLIC_SOL_PRICE_FEED_ACCOUNT?.trim();
  const account = s
    ? new PublicKey(s)
    : REALTIME_TRACKER_DEFAULT_ACCOUNT;
  return { rpc, account };
}
