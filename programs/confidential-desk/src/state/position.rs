use anchor_lang::prelude::*;

#[account]
pub struct BorrowerPosition {
    pub owner: Pubkey,
    pub desk: Pubkey,
    pub collateral_amount: u64,
    pub debt_amount: u64,
    pub last_accrual_ts: i64,
    pub is_liquidatable: u8,
}

impl BorrowerPosition {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 1;
}

#[account]
pub struct LenderPosition {
    pub owner: Pubkey,
    pub desk: Pubkey,
    /// USDC atoms notionally supplied (mirrors vault share accounting on PER).
    pub deposit_amount: u64,
    pub lp_shares: u64,
}

impl LenderPosition {
    pub const LEN: usize = 32 + 32 + 8 + 8;
}
