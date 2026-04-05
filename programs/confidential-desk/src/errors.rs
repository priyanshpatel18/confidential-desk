use anchor_lang::prelude::*;

#[error_code]
pub enum DeskError {
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Exceeds max LTV")]
    ExceedsMaxLtv,
    #[msg("Position is not liquidatable")]
    NotLiquidatable,
    #[msg("Position has open debt")]
    OpenDebt,
    #[msg("Position has open collateral")]
    OpenCollateral,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Invalid timestamp")]
    InvalidTimestamp,
    #[msg("Unauthorized")]
    Unauthorized,
    /// User SPL token account on this rollup has less than the amount the instruction would debit.
    /// Fund the Associated Token Account for this mint (same balance as ephemeral/private Payments API).
    #[msg("Insufficient SPL token balance in the user ATA on this rollup for this instruction")]
    InsufficientRollupSplAta,
}
