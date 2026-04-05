use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use ephemeral_rollups_sdk::access_control::instructions::CreatePermissionCpiBuilder;
use ephemeral_rollups_sdk::access_control::structs::{Member, MembersArgs, AUTHORITY_FLAG, TX_LOGS_FLAG};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::errors::DeskError;
use crate::state::ledger::DeskLedger;
use crate::{DelegateDeskLedgerPda, InitializeDesk, InitDeskVaults, UpdateOracle};
use crate::LEDGER_SEED;

pub fn initialize_desk_handler(
    ctx: Context<InitializeDesk>,
    interest_rate_bps: u16,
    ltv_max_bps: u16,
    liquidation_threshold_bps: u16,
    liquidation_bonus_bps: u16,
    collateral_price_q12: u64,
) -> Result<()> {
    let desk = &mut ctx.accounts.desk;
    desk.authority = ctx.accounts.authority.key();
    desk.collateral_mint = ctx.accounts.collateral_mint.key();
    desk.borrow_mint = ctx.accounts.borrow_mint.key();
    let dk = desk.key();
    desk.collateral_vault = get_associated_token_address(&dk, &ctx.accounts.collateral_mint.key());
    desk.borrow_vault = get_associated_token_address(&dk, &ctx.accounts.borrow_mint.key());
    desk.lp_mint = ctx.accounts.lp_mint.key();
    desk.interest_rate_bps = interest_rate_bps;
    desk.ltv_max_bps = ltv_max_bps;
    desk.liquidation_threshold_bps = liquidation_threshold_bps;
    desk.liquidation_bonus_bps = liquidation_bonus_bps;
    desk.collateral_price_q12 = collateral_price_q12;
    desk.bump = ctx.bumps.desk;
    desk._pad = [0u8; 7];

    let ledger = &mut ctx.accounts.desk_ledger;
    ledger.desk = dk;
    ledger.total_deposits = 0;
    ledger.total_borrowed = 0;
    ledger.lp_total_minted = 0;

    let auth = ctx.accounts.authority.key();
    let lb = ctx.bumps.desk_ledger;
    let ledger_seeds: [&[u8]; 3] = [LEDGER_SEED, dk.as_ref(), &[lb]];
    let inv = [&ledger_seeds[..]];

    CreatePermissionCpiBuilder::new(&ctx.accounts.permission_program.to_account_info())
        .permissioned_account(&ctx.accounts.desk_ledger.to_account_info())
        .permission(&ctx.accounts.permission_desk_ledger.to_account_info())
        .payer(&ctx.accounts.authority.to_account_info())
        .system_program(&ctx.accounts.system_program.to_account_info())
        .args(MembersArgs {
            members: Some(vec![Member {
                flags: AUTHORITY_FLAG | TX_LOGS_FLAG,
                pubkey: auth,
            }]),
        })
        .invoke_signed(&inv)?;

    Ok(())
}

/// Create desk SPL vault ATAs on the Ephemeral Rollup (first caller pays rent).
pub fn init_desk_vaults_handler(ctx: Context<InitDeskVaults>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.collateral_vault.key(),
        ctx.accounts.desk.collateral_vault,
        DeskError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.borrow_vault.key(),
        ctx.accounts.desk.borrow_vault,
        DeskError::Unauthorized
    );
    Ok(())
}

pub fn update_oracle_handler(ctx: Context<UpdateOracle>, collateral_price_q12: u64) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.desk.authority,
        ctx.accounts.authority.key(),
        DeskError::Unauthorized
    );
    ctx.accounts.desk.collateral_price_q12 = collateral_price_q12;
    Ok(())
}

pub fn delegate_desk_ledger_handler(ctx: Context<DelegateDeskLedgerPda>) -> Result<()> {
    let desk_key = {
        let data = ctx.accounts.pda.try_borrow_data()?;
        let mut r: &[u8] = &data;
        let ledger = DeskLedger::try_deserialize(&mut r)?;
        let dk = ctx.accounts.desk.key();
        require_keys_eq!(ledger.desk, dk, DeskError::Unauthorized);
        let (expected, _) = Pubkey::find_program_address(&[LEDGER_SEED, dk.as_ref()], &crate::ID);
        require_keys_eq!(expected, ctx.accounts.pda.key(), DeskError::Unauthorized);
        dk
    };

    let seeds: &[&[u8]] = &[LEDGER_SEED, desk_key.as_ref()];
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());
    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        seeds,
        DelegateConfig {
            validator,
            ..Default::default()
        },
    )?;
    Ok(())
}
