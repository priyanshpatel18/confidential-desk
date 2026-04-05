use anchor_lang::prelude::*;

/// Pool accounting on PER (delegated).
#[account]
pub struct DeskLedger {
    pub desk: Pubkey,
    pub total_deposits: u64,
    pub total_borrowed: u64,
    /// Mirrors LP supply on PER for share math.
    pub lp_total_minted: u64,
}

impl DeskLedger {
    pub const LEN: usize = 32 + 8 + 8 + 8;
}
