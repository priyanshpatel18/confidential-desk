use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    program_error::ProgramError,
};
use anchor_spl::token::{self, Transfer};
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};

use crate::errors::DeskError;
use crate::{HealthTickBorrower, LiquidatePer, ScheduleHealthCrankDesk};
use crate::ScheduleHealthCrankDeskArgs;
use crate::utils::{accrue_interest_borrower, is_underwater};
use crate::DESK_SEED;
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;

pub fn health_tick_borrower_handler(ctx: Context<HealthTickBorrower>) -> Result<()> {
    let desk = &ctx.accounts.desk;
    let pos = &mut ctx.accounts.borrower_position;
    require_keys_eq!(pos.desk, desk.key(), DeskError::Unauthorized);

    accrue_interest_borrower(pos, desk)?;
    if is_underwater(pos, desk) {
        pos.is_liquidatable = 1;
    } else {
        pos.is_liquidatable = 0;
    }
    Ok(())
}

pub fn schedule_health_crank_desk_handler(
    ctx: Context<ScheduleHealthCrankDesk>,
    args: ScheduleHealthCrankDeskArgs,
) -> Result<()> {
    // Anchor discriminator for `health_tick_borrower` — updated after `anchor build`.
    const HEALTH_TICK_BORROWER_DISC: [u8; 8] = [97, 125, 1, 115, 135, 65, 233, 165];
    let health_ix = Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.desk.key(), false),
            AccountMeta::new(ctx.accounts.borrower_position.key(), false),
        ],
        data: HEALTH_TICK_BORROWER_DISC.to_vec(),
    };

    let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
        task_id: args.task_id,
        execution_interval_millis: args.execution_interval_millis,
        iterations: args.iterations,
        instructions: vec![health_ix],
    }))
    .map_err(|_| ProgramError::InvalidArgument)?;

    let schedule_ix = Instruction::new_with_bytes(
        MAGIC_PROGRAM_ID,
        &ix_data,
        vec![
            AccountMeta::new(ctx.accounts.payer.key(), true),
            AccountMeta::new(ctx.accounts.borrower_position.key(), false),
        ],
    );

    invoke_signed(
        &schedule_ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.borrower_position.to_account_info(),
        ],
        &[],
    )?;
    Ok(())
}

pub fn liquidate_per_handler(ctx: Context<LiquidatePer>) -> Result<()> {
    require!(
        ctx.accounts.borrower_position.is_liquidatable == 1,
        DeskError::NotLiquidatable
    );
    let desk = &ctx.accounts.desk;
    let pos = &mut ctx.accounts.borrower_position;
    require_keys_eq!(pos.desk, desk.key(), DeskError::Unauthorized);
    require_keys_eq!(
        ctx.accounts.borrow_vault.key(),
        desk.borrow_vault,
        DeskError::Unauthorized
    );
    require_keys_eq!(
        ctx.accounts.collateral_vault.key(),
        desk.collateral_vault,
        DeskError::Unauthorized
    );

    accrue_interest_borrower(pos, desk)?;
    let debt = pos.debt_amount;
    let col = pos.collateral_amount;
    require!(debt > 0 && col > 0, DeskError::InvalidAmount);

    let cpi_pay = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.liquidator_borrow_ata.to_account_info(),
            to: ctx.accounts.borrow_vault.to_account_info(),
            authority: ctx.accounts.liquidator.to_account_info(),
        },
    );
    token::transfer(cpi_pay, debt)?; // liquidator signs

    let bump_seed = [desk.bump];
    let signer: &[&[&[u8]]] = &[&[
        DESK_SEED,
        desk.collateral_mint.as_ref(),
        desk.borrow_mint.as_ref(),
        &bump_seed,
    ]];
    let cpi_col = CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        Transfer {
            from: ctx.accounts.collateral_vault.to_account_info(),
            to: ctx.accounts.liquidator_collateral_ata.to_account_info(),
            authority: desk.to_account_info(),
        },
        signer,
    );
    token::transfer(cpi_col, col)?;

    let ledger = &mut ctx.accounts.desk_ledger;
    ledger.total_borrowed = ledger.total_borrowed.saturating_sub(debt);

    pos.debt_amount = 0;
    pos.collateral_amount = 0;
    pos.is_liquidatable = 0;

    Ok(())
}
