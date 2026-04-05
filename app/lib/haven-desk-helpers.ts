/**
 * Pure helpers for the confidential lending desk UI (no React).
 */

import { BN } from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

import {
  DESK_LEDGER_INACTIVE_PREFIX,
  type DeskSummary,
  type LenderPositionData,
  type PositionData,
} from "@/lib/desk-actions";
import {
  deskInvalidWritableRollupMessage,
  messageLooksLikeInvalidWritableOnRollup,
} from "@/lib/desk-rpc-policy";

export type Portfolio = {
  collateralDecimals: number;
  borrowDecimals: number;
  lpDecimals: number;
  nativeSolBal: string;
  collateralBal: string;
  borrowBal: string;
  lpBal: string;
  shieldedCollateral: string;
  shieldedBorrow: string;
  deskBorrowedDisplay: string;
  position: PositionData | null;
  lender: LenderPositionData | null;
  deskSnapshot: DeskSummary | null;
};

export const initialPortfolio: Portfolio = {
  collateralDecimals: 9,
  borrowDecimals: 6,
  lpDecimals: 6,
  nativeSolBal: "0",
  collateralBal: "0",
  borrowBal: "0",
  lpBal: "0",
  shieldedCollateral: "—",
  shieldedBorrow: "—",
  deskBorrowedDisplay: "0",
  position: null,
  lender: null,
  deskSnapshot: null,
};

export const NATIVE_SOL_FEE_RESERVE_LAMPORTS = new BN(10_000_000);

export function toRawAmount(amountStr: string, decimals: number): BN {
  const t = amountStr.trim();
  if (!t || !/^\d*\.?\d*$/.test(t)) return new BN(0);
  const [whole, frac = ""] = t.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = `${whole || "0"}${fracPadded}`.replace(/^0+/, "") || "0";
  return new BN(combined);
}

export function formatRaw(raw: BN, decimals: number): string {
  const s = raw.toString(10).padStart(decimals + 1, "0");
  if (decimals === 0) return s;
  const i = s.length - decimals;
  const intPart = s.slice(0, i).replace(/^0+/, "") || "0";
  const fracPart = s.slice(i).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

export function formatNativeSol(lamports: number): string {
  if (lamports === 0) return "0";
  const n = lamports / LAMPORTS_PER_SOL;
  const s = n.toFixed(6).replace(/\.?0+$/, "");
  return s || "0";
}

export function bnMin(a: BN, b: BN): BN {
  return a.lt(b) ? a : b;
}

export function bnMax(a: BN, b: BN): BN {
  return a.gt(b) ? a : b;
}

export function spendableNativeSolRaw(
  nativeSolDisplay: string,
  collateralDecimals: number,
): BN {
  const raw = toRawAmount(nativeSolDisplay, collateralDecimals);
  const out = raw.sub(NATIVE_SOL_FEE_RESERVE_LAMPORTS);
  return out.gt(new BN(0)) ? out : new BN(0);
}

export async function getWsolLamportsOnBase(
  connection: Connection,
  owner: PublicKey,
): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(
    NATIVE_MINT,
    owner,
    false,
    TOKEN_PROGRAM_ID,
  );
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return BigInt(bal.value.amount);
  } catch {
    return BigInt(0);
  }
}

export function coercePerBalance(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") {
    const t = v.trim();
    return t === "" ? "—" : t;
  }
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
    return String(Math.trunc(v));
  }
  return "—";
}

export function friendlyTxError(message: string): string {
  if (/Account does not exist or has no data/i.test(message)) {
    return (
      "The confidential lending desk is not initialized on this network yet. " +
      "Run initialize_desk once for SOL + cluster USDC."
    );
  }
  if (message.includes(DESK_LEDGER_INACTIVE_PREFIX)) {
    return message.replace(DESK_LEDGER_INACTIVE_PREFIX, "").trim();
  }
  if (messageLooksLikeInvalidWritableOnRollup(message)) {
    return deskInvalidWritableRollupMessage();
  }
  return message;
}
