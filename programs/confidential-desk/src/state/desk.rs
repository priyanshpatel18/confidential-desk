use anchor_lang::prelude::*;

#[account]
pub struct DeskConfig {
    pub authority: Pubkey,
    pub collateral_mint: Pubkey,
    pub borrow_mint: Pubkey,
    pub collateral_vault: Pubkey,
    pub borrow_vault: Pubkey,
    pub lp_mint: Pubkey,
    pub interest_rate_bps: u16,
    pub ltv_max_bps: u16,
    pub liquidation_threshold_bps: u16,
    pub liquidation_bonus_bps: u16,
    pub collateral_price_q12: u64,
    pub bump: u8,
    pub _pad: [u8; 7],
}

impl DeskConfig {
    pub const LEN: usize = 32 * 6 + 2 + 2 + 2 + 2 + 8 + 1 + 7;
}
