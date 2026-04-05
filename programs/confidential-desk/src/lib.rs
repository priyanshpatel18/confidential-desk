#![allow(unexpected_cfgs)]

mod ix_accounts;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

use ephemeral_rollups_sdk::anchor::ephemeral;

pub use ix_accounts::*;
pub use instructions::*;

pub const DESK_SEED: &[u8] = b"desk";
pub const BORROWER_SEED: &[u8] = b"borrower";
pub const LENDER_SEED: &[u8] = b"lender";
pub const LP_MINT_SEED: &[u8] = b"lp_mint";
pub const LEDGER_SEED: &[u8] = b"ledger";
pub const PRICE_SCALE: u128 = 1_000_000_000_000u128;

declare_id!("HVN74rb5SBJoi6iNiPYKuKpiDB5xs5BBXCqKuzoFuZDb");

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScheduleHealthCrankDeskArgs {
    pub task_id: i64,
    pub execution_interval_millis: i64,
    pub iterations: i64,
}

#[ephemeral]
#[program]
pub mod confidential_desk {
    use super::*;

    pub fn initialize_desk(
        ctx: Context<InitializeDesk>,
        interest_rate_bps: u16,
        ltv_max_bps: u16,
        liquidation_threshold_bps: u16,
        liquidation_bonus_bps: u16,
        collateral_price_q12: u64,
    ) -> Result<()> {
        instructions::desk::initialize_desk_handler(
            ctx,
            interest_rate_bps,
            ltv_max_bps,
            liquidation_threshold_bps,
            liquidation_bonus_bps,
            collateral_price_q12,
        )
    }

    pub fn init_desk_vaults(ctx: Context<InitDeskVaults>) -> Result<()> {
        instructions::desk::init_desk_vaults_handler(ctx)
    }

    /// Base-only: ESPL bootstrap for the borrow mint / pool vault (desk PDA is off-curve; JS `delegateSpl` cannot do this).
    pub fn bootstrap_desk_borrow_mint_espl(
        ctx: Context<BootstrapDeskBorrowMintEspl>,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::espl::bootstrap_desk_borrow_mint_espl_handler(ctx, validator)
    }

    /// Base-only: ESPL bootstrap for the LP mint (enables `MintTo` on PER for that mint).
    pub fn bootstrap_desk_lp_mint_espl(
        ctx: Context<BootstrapDeskLpMintEspl>,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        instructions::espl::bootstrap_desk_lp_mint_espl_handler(ctx, validator)
    }

    pub fn update_oracle(ctx: Context<UpdateOracle>, collateral_price_q12: u64) -> Result<()> {
        instructions::desk::update_oracle_handler(ctx, collateral_price_q12)
    }

    pub fn delegate_desk_ledger(ctx: Context<DelegateDeskLedgerPda>) -> Result<()> {
        instructions::desk::delegate_desk_ledger_handler(ctx)
    }

    pub fn open_borrower(ctx: Context<OpenBorrower>) -> Result<()> {
        instructions::borrower::open_borrower_handler(ctx)
    }

    pub fn delegate_borrower(ctx: Context<DelegateBorrowerPda>) -> Result<()> {
        instructions::borrower::delegate_borrower_handler(ctx)
    }

    pub fn deposit_collateral(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
        instructions::borrower::deposit_collateral_handler(ctx, amount)
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        instructions::borrower::borrow_handler(ctx, amount)
    }

    pub fn repay(ctx: Context<Repay>, amount: u64) -> Result<()> {
        instructions::borrower::repay_handler(ctx, amount)
    }

    pub fn withdraw_collateral(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
        instructions::borrower::withdraw_collateral_handler(ctx, amount)
    }

    pub fn open_lender(ctx: Context<OpenLender>) -> Result<()> {
        instructions::lender::open_lender_handler(ctx)
    }

    pub fn delegate_lender(ctx: Context<DelegateLenderPda>) -> Result<()> {
        instructions::lender::delegate_lender_handler(ctx)
    }

    pub fn deposit_liquidity(ctx: Context<DepositLiquidity>, amount: u64, lp_to_mint: u64) -> Result<()> {
        instructions::lender::deposit_liquidity_handler(ctx, amount, lp_to_mint)
    }

    pub fn withdraw_lp(ctx: Context<WithdrawLp>, shares: u64) -> Result<()> {
        instructions::lender::withdraw_lp_handler(ctx, shares)
    }

    pub fn health_tick_borrower(ctx: Context<HealthTickBorrower>) -> Result<()> {
        instructions::health::health_tick_borrower_handler(ctx)
    }

    pub fn schedule_health_crank_desk(
        ctx: Context<ScheduleHealthCrankDesk>,
        args: ScheduleHealthCrankDeskArgs,
    ) -> Result<()> {
        instructions::health::schedule_health_crank_desk_handler(ctx, args)
    }

    pub fn liquidate_per(ctx: Context<LiquidatePer>) -> Result<()> {
        instructions::health::liquidate_per_handler(ctx)
    }

    pub fn close_borrower_position_per(ctx: Context<CloseBorrowerPositionPer>) -> Result<()> {
        instructions::close::close_borrower_position_per_handler(ctx)
    }

    pub fn close_lender_position_per(ctx: Context<CloseLenderPositionPer>) -> Result<()> {
        instructions::close::close_lender_position_per_handler(ctx)
    }
}
