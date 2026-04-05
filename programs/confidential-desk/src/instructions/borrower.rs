use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use ephemeral_rollups_sdk::access_control::instructions::CreatePermissionCpiBuilder;
use ephemeral_rollups_sdk::access_control::structs::{Member, MembersArgs, AUTHORITY_FLAG, TX_LOGS_FLAG};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::errors::DeskError;
use crate::state::BorrowerPosition;
use crate::utils::{
    accrue_interest_borrower, max_debt_for_collateral, require_spl_ata_balance_at_least,
};
use crate::{
    Borrow, DelegateBorrowerPda, DepositCollateral, OpenBorrower, Repay, WithdrawCollateral,
};
use crate::{BORROWER_SEED, DESK_SEED};

fn create_owner_permission<'info>(
    permission_program: &AccountInfo<'info>,
    permission: &AccountInfo<'info>,
    permissioned: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    owner: Pubkey,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let members = Some(vec![Member {
        flags: AUTHORITY_FLAG | TX_LOGS_FLAG,
        pubkey: owner,
    }]);
    CreatePermissionCpiBuilder::new(permission_program)
        .permissioned_account(permissioned)
        .permission(permission)
        .payer(payer)
        .system_program(system_program)
        .args(MembersArgs { members })
        .invoke_signed(signer_seeds)?;
    Ok(())
}

pub fn open_borrower_handler(ctx: Context<OpenBorrower>) -> Result<()> {
    let desk_key = ctx.accounts.desk.key();
    let owner_key = ctx.accounts.owner.key();

    let pos = &mut ctx.accounts.borrower_position;
    pos.owner = owner_key;
    pos.desk = desk_key;
    pos.collateral_amount = 0;
    pos.debt_amount = 0;
    pos.last_accrual_ts = Clock::get()?.unix_timestamp;
    pos.is_liquidatable = 0;

    let bump = ctx.bumps.borrower_position;
    let pos_seeds: [&[u8]; 4] = [
        BORROWER_SEED,
        desk_key.as_ref(),
        owner_key.as_ref(),
        &[bump],
    ];
    let pos_inv = [&pos_seeds[..]];

    create_owner_permission(
        &ctx.accounts.permission_program.to_account_info(),
        &ctx.accounts.permission_borrower.to_account_info(),
        &ctx.accounts.borrower_position.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        owner_key,
        &pos_inv,
    )?;

    Ok(())
}

pub fn delegate_borrower_handler(ctx: Context<DelegateBorrowerPda>) -> Result<()> {
    let owner = ctx.accounts.payer.key();
    let desk_key = {
        let data = ctx.accounts.pda.try_borrow_data()?;
        let mut r: &[u8] = &data;
        let pos = BorrowerPosition::try_deserialize(&mut r)?;
        require_keys_eq!(pos.owner, owner, DeskError::Unauthorized);
        require_keys_eq!(pos.desk, ctx.accounts.desk.key(), DeskError::Unauthorized);
        let dk = pos.desk;
        let (expected, _) = Pubkey::find_program_address(
            &[BORROWER_SEED, dk.as_ref(), owner.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(expected, ctx.accounts.pda.key(), DeskError::Unauthorized);
        dk
    };

    let seeds: &[&[u8]] = &[BORROWER_SEED, desk_key.as_ref(), owner.as_ref()];
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

pub fn deposit_collateral_handler(ctx: Context<DepositCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, DeskError::InvalidAmount);
    require_keys_eq!(
        ctx.accounts.borrower_position.owner,
        ctx.accounts.owner.key(),
        DeskError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.borrower_position.desk,
        ctx.accounts.desk.key(),
        DeskError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.collateral_vault.key(),
        ctx.accounts.desk.collateral_vault,
        DeskError::Unauthorized
    );

    require_spl_ata_balance_at_least(&ctx.accounts.user_collateral_ata, amount)?;

    let cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_collateral_ata.to_account_info(),
            to: ctx.accounts.collateral_vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        },
    );
    token::transfer(cpi, amount)?;

    let pos = &mut ctx.accounts.borrower_position;
    pos.collateral_amount = pos
        .collateral_amount
        .checked_add(amount)
        .ok_or(DeskError::MathOverflow)?;
    Ok(())
}

pub fn borrow_handler(ctx: Context<Borrow>, amount: u64) -> Result<()> {
    require!(amount > 0, DeskError::InvalidAmount);
    let desk = &ctx.accounts.desk;
    let ledger = &mut ctx.accounts.desk_ledger;
    let pos = &mut ctx.accounts.borrower_position;
    require_keys_eq!(pos.owner, ctx.accounts.owner.key(), DeskError::Unauthorized);
    require_keys_eq!(pos.desk, desk.key(), DeskError::Unauthorized);
    require_keys_eq!(
        ctx.accounts.borrow_vault.key(),
        desk.borrow_vault,
        DeskError::Unauthorized
    );

    accrue_interest_borrower(pos, desk)?;
    let new_debt = pos
        .debt_amount
        .checked_add(amount)
        .ok_or(DeskError::MathOverflow)?;
    let max = max_debt_for_collateral(
        pos.collateral_amount,
        desk.collateral_price_q12,
        desk.ltv_max_bps,
    )?;
    require!(new_debt <= max, DeskError::ExceedsMaxLtv);

    let avail = ledger
        .total_deposits
        .checked_sub(ledger.total_borrowed)
        .ok_or(DeskError::MathOverflow)?;
    require!(avail >= amount, DeskError::InsufficientLiquidity);

    let bump_seed = [desk.bump];
    let signer: &[&[&[u8]]] = &[&[
        DESK_SEED,
        desk.collateral_mint.as_ref(),
        desk.borrow_mint.as_ref(),
        &bump_seed,
    ]];
    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.borrow_vault.to_account_info(),
            to: ctx.accounts.user_borrow_ata.to_account_info(),
            authority: desk.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi, amount)?;

    pos.debt_amount = new_debt;
    ledger.total_borrowed = ledger
        .total_borrowed
        .checked_add(amount)
        .ok_or(DeskError::MathOverflow)?;
    Ok(())
}

pub fn repay_handler(ctx: Context<Repay>, amount: u64) -> Result<()> {
    require!(amount > 0, DeskError::InvalidAmount);
    let pos = &mut ctx.accounts.borrower_position;
    require_keys_eq!(pos.owner, ctx.accounts.owner.key(), DeskError::Unauthorized);
    require_keys_eq!(pos.desk, ctx.accounts.desk.key(), DeskError::Unauthorized);
    require_keys_eq!(
        ctx.accounts.borrow_vault.key(),
        ctx.accounts.desk.borrow_vault,
        DeskError::Unauthorized
    );

    accrue_interest_borrower(pos, &ctx.accounts.desk)?;
    let pay = amount.min(pos.debt_amount);

    require_spl_ata_balance_at_least(&ctx.accounts.user_borrow_ata, pay)?;

    let cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.user_borrow_ata.to_account_info(),
            to: ctx.accounts.borrow_vault.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        },
    );
    token::transfer(cpi, pay)?;

    pos.debt_amount = pos.debt_amount.saturating_sub(pay);
    let ledger = &mut ctx.accounts.desk_ledger;
    ledger.total_borrowed = ledger.total_borrowed.saturating_sub(pay);
    Ok(())
}

pub fn withdraw_collateral_handler(ctx: Context<WithdrawCollateral>, amount: u64) -> Result<()> {
    require!(amount > 0, DeskError::InvalidAmount);
    let desk = &ctx.accounts.desk;
    let pos = &mut ctx.accounts.borrower_position;
    require_keys_eq!(pos.owner, ctx.accounts.owner.key(), DeskError::Unauthorized);
    require_keys_eq!(pos.desk, desk.key(), DeskError::Unauthorized);
    require!(amount <= pos.collateral_amount, DeskError::InvalidAmount);
    require_keys_eq!(
        ctx.accounts.collateral_vault.key(),
        desk.collateral_vault,
        DeskError::Unauthorized
    );

    accrue_interest_borrower(pos, desk)?;
    let after = pos.collateral_amount.saturating_sub(amount);
    let max_debt = max_debt_for_collateral(after, desk.collateral_price_q12, desk.ltv_max_bps)?;
    require!(pos.debt_amount <= max_debt, DeskError::ExceedsMaxLtv);

    let bump_seed = [desk.bump];
    let signer: &[&[&[u8]]] = &[&[
        DESK_SEED,
        desk.collateral_mint.as_ref(),
        desk.borrow_mint.as_ref(),
        &bump_seed,
    ]];
    let cpi = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.collateral_vault.to_account_info(),
            to: ctx.accounts.user_collateral_ata.to_account_info(),
            authority: desk.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi, amount)?;

    pos.collateral_amount = after;
    Ok(())
}
