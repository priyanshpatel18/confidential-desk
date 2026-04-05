use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo, Transfer};

use ephemeral_rollups_sdk::access_control::instructions::CreatePermissionCpiBuilder;
use ephemeral_rollups_sdk::access_control::structs::{Member, MembersArgs, AUTHORITY_FLAG, TX_LOGS_FLAG};
use ephemeral_rollups_sdk::cpi::DelegateConfig;

use crate::errors::DeskError;
use crate::state::LenderPosition;
use crate::utils::require_spl_ata_balance_at_least;
use crate::{
    DelegateLenderPda, DepositLiquidity, OpenLender, WithdrawLp,
};
use crate::{DESK_SEED, LENDER_SEED};

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

pub fn open_lender_handler(ctx: Context<OpenLender>) -> Result<()> {
    let desk_key = ctx.accounts.desk.key();
    let owner_key = ctx.accounts.owner.key();

    let lp = &mut ctx.accounts.lender_position;
    lp.owner = owner_key;
    lp.desk = desk_key;
    lp.deposit_amount = 0;
    lp.lp_shares = 0;

    let bump = ctx.bumps.lender_position;
    let seeds: [&[u8]; 4] = [LENDER_SEED, desk_key.as_ref(), owner_key.as_ref(), &[bump]];
    let inv = [&seeds[..]];
    create_owner_permission(
        &ctx.accounts.permission_program.to_account_info(),
        &ctx.accounts.permission_lender.to_account_info(),
        &ctx.accounts.lender_position.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        owner_key,
        &inv,
    )?;

    Ok(())
}

pub fn delegate_lender_handler(ctx: Context<DelegateLenderPda>) -> Result<()> {
    let owner = ctx.accounts.payer.key();
    let desk_key = {
        let data = ctx.accounts.pda.try_borrow_data()?;
        let mut r: &[u8] = &data;
        let lp = LenderPosition::try_deserialize(&mut r)?;
        require_keys_eq!(lp.owner, owner, DeskError::Unauthorized);
        require_keys_eq!(lp.desk, ctx.accounts.desk.key(), DeskError::Unauthorized);
        let dk = lp.desk;
        let (expected, _) = Pubkey::find_program_address(
            &[LENDER_SEED, dk.as_ref(), owner.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(expected, ctx.accounts.pda.key(), DeskError::Unauthorized);
        dk
    };

    let seeds: &[&[u8]] = &[LENDER_SEED, desk_key.as_ref(), owner.as_ref()];
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

pub fn deposit_liquidity_handler(ctx: Context<DepositLiquidity>, amount: u64, lp_to_mint: u64) -> Result<()> {
    require!(amount > 0 && lp_to_mint > 0, DeskError::InvalidAmount);
    let desk = &ctx.accounts.desk;
    require_keys_eq!(
        ctx.accounts.borrow_vault.key(),
        desk.borrow_vault,
        DeskError::Unauthorized
    );

    require_spl_ata_balance_at_least(&ctx.accounts.lender_borrow_ata, amount)?;

    let cpi = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.lender_borrow_ata.to_account_info(),
            to: ctx.accounts.borrow_vault.to_account_info(),
            authority: ctx.accounts.lender.to_account_info(),
        },
    );
    token::transfer(cpi, amount)?;

    let bump_seed = [desk.bump];
    let signer: &[&[&[u8]]] = &[&[
        DESK_SEED,
        desk.collateral_mint.as_ref(),
        desk.borrow_mint.as_ref(),
        &bump_seed,
    ]];
    let cpi_mint = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        MintTo {
            mint: ctx.accounts.lp_mint.to_account_info(),
            to: ctx.accounts.lender_lp_ata.to_account_info(),
            authority: desk.to_account_info(),
        },
        signer,
    );
    token::mint_to(cpi_mint, lp_to_mint)?;

    let lp = &mut ctx.accounts.lender_position;
    require_keys_eq!(lp.owner, ctx.accounts.lender.key(), DeskError::Unauthorized);
    require_keys_eq!(lp.desk, desk.key(), DeskError::Unauthorized);
    lp.deposit_amount = lp
        .deposit_amount
        .checked_add(amount)
        .ok_or(DeskError::MathOverflow)?;
    lp.lp_shares = lp
        .lp_shares
        .checked_add(lp_to_mint)
        .ok_or(DeskError::MathOverflow)?;

    let ledger = &mut ctx.accounts.desk_ledger;
    ledger.total_deposits = ledger
        .total_deposits
        .checked_add(amount)
        .ok_or(DeskError::MathOverflow)?;
    ledger.lp_total_minted = ledger
        .lp_total_minted
        .checked_add(lp_to_mint)
        .ok_or(DeskError::MathOverflow)?;
    Ok(())
}

pub fn withdraw_lp_handler(ctx: Context<WithdrawLp>, shares: u64) -> Result<()> {
    require!(shares > 0, DeskError::InvalidAmount);
    let desk = &ctx.accounts.desk;
    let ledger = &mut ctx.accounts.desk_ledger;
    let lp = &mut ctx.accounts.lender_position;
    require_keys_eq!(lp.owner, ctx.accounts.lender.key(), DeskError::Unauthorized);
    require_keys_eq!(lp.desk, desk.key(), DeskError::Unauthorized);
    require!(shares <= lp.lp_shares, DeskError::InvalidAmount);
    require_keys_eq!(
        ctx.accounts.borrow_vault.key(),
        desk.borrow_vault,
        DeskError::Unauthorized
    );

    require!(ledger.lp_total_minted > 0, DeskError::InsufficientLiquidity);

    let out = u64::try_from(
        u128::from(shares)
            .checked_mul(u128::from(ledger.total_deposits))
            .ok_or(DeskError::MathOverflow)?
            .checked_div(u128::from(ledger.lp_total_minted))
            .ok_or(DeskError::MathOverflow)?,
    )
    .map_err(|_| error!(DeskError::MathOverflow))?;

    let available = ledger
        .total_deposits
        .checked_sub(ledger.total_borrowed)
        .ok_or(DeskError::MathOverflow)?;
    require!(out <= available, DeskError::InsufficientLiquidity);

    require_spl_ata_balance_at_least(&ctx.accounts.lender_lp_ata, shares)?;

    let cpi_burn = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        anchor_spl::token::Burn {
            mint: ctx.accounts.lp_mint.to_account_info(),
            from: ctx.accounts.lender_lp_ata.to_account_info(),
            authority: ctx.accounts.lender.to_account_info(),
        },
    );
    token::burn(cpi_burn, shares)?;

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
            to: ctx.accounts.lender_borrow_ata.to_account_info(),
            authority: desk.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi, out)?;

    lp.lp_shares = lp.lp_shares.saturating_sub(shares);
    lp.deposit_amount = lp.deposit_amount.saturating_sub(out);
    ledger.total_deposits = ledger.total_deposits.saturating_sub(out);
    ledger.lp_total_minted = ledger.lp_total_minted.saturating_sub(shares);
    Ok(())
}
