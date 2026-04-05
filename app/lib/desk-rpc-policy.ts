/**
 * Which instructions must hit Solana base vs PER — same idea as sealed-auction’s app using
 * `ConnectionProvider` (base RPC) for authority paths while `#[ephemeral]` handles hot paths.
 * Sending base-only work to the rollup causes `InvalidWritableAccount` / Anchor constraint mut failures.
 *
 * On PER, `DeskConfig` is mirrored from base and must stay **read-only** in lending instructions
 * (`deposit_liquidity`, `withdraw_lp`, `withdraw_collateral`, …); only delegated PDAs + SPL token
 * accounts are writable there.
 */

/** Instruction names that must never be submitted to the ER JSON-RPC (use wallet / app base RPC). */
export const DESK_INSTRUCTIONS_BASE_ONLY = new Set<string>([
  "initialize_desk",
  "init_desk_vaults",
  "bootstrap_desk_borrow_mint_espl",
  "bootstrap_desk_lp_mint_espl",
  "open_borrower",
  "open_lender",
  "delegate_borrower",
  "delegate_lender",
  "delegate_desk_ledger",
  "update_oracle",
  "close_borrower",
  "close_lender",
]);

/** Lending / health paths intended for MagicBlock PER after delegation + vault init on base. */
export const DESK_INSTRUCTIONS_PER_ELIGIBLE = new Set<string>([
  "deposit_collateral",
  "borrow",
  "repay",
  "withdraw_collateral",
  "deposit_liquidity",
  "withdraw_lp",
  "liquidate",
  "health_tick_borrower",
]);

/**
 * User-facing copy when simulation or execution reports invalid writable / rollup mismatch.
 */
export function deskInvalidWritableRollupMessage(): string {
  return [
    "This action was simulated or sent on the Ephemeral Rollup, but it needs a normal Solana (base) transaction.",
    "Desk setup — init vaults, open position, activate/delegate — must use your wallet’s base network RPC (same as MagicBlock RPS / sealed-auction bidding).",
    "Lending moves (deposit, borrow, …) run on PER only after vaults exist on base, the desk ledger is delegated, and Ephemeral SPL is bootstrapped for the desk (see `yarn bootstrap-desk-espl-devnet`).",
    "Fix: init vaults on base, activate/delegate, run desk ESPL bootstrap as authority, ensure NEXT_PUBLIC_* ER URLs match devnet, then retry.",
  ].join(" ");
}

export function messageLooksLikeInvalidWritableOnRollup(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("invalidwritableaccount") ||
    m.includes("invalid writable account") ||
    /constraint.?mut|"custom":\s*2000|anchor_error__constraint_mut/i.test(msg)
  );
}
