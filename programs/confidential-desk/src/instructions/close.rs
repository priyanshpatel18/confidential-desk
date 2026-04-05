use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::ephem::commit_and_undelegate_accounts;

use crate::errors::DeskError;
use crate::{CloseBorrowerPositionPer, CloseLenderPositionPer};

pub fn close_borrower_position_per_handler(ctx: Context<CloseBorrowerPositionPer>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.owner.key(),
        ctx.accounts.borrower_position.owner,
        DeskError::Unauthorized
    );
    require!(
        ctx.accounts.borrower_position.debt_amount == 0,
        DeskError::OpenDebt
    );
    require!(
        ctx.accounts.borrower_position.collateral_amount == 0,
        DeskError::OpenCollateral
    );

    ctx.accounts.borrower_position.exit(&crate::ID)?;
    commit_and_undelegate_accounts(
        &ctx.accounts.owner.to_account_info(),
        vec![&ctx.accounts.borrower_position.to_account_info()],
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
    )?;
    Ok(())
}

pub fn close_lender_position_per_handler(ctx: Context<CloseLenderPositionPer>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.owner.key(),
        ctx.accounts.lender_position.owner,
        DeskError::Unauthorized
    );
    require!(
        ctx.accounts.lender_position.lp_shares == 0,
        DeskError::OpenCollateral
    );
    require!(
        ctx.accounts.lender_position.deposit_amount == 0,
        DeskError::OpenDebt
    );

    ctx.accounts.lender_position.exit(&crate::ID)?;
    commit_and_undelegate_accounts(
        &ctx.accounts.owner.to_account_info(),
        vec![&ctx.accounts.lender_position.to_account_info()],
        &ctx.accounts.magic_context.to_account_info(),
        &ctx.accounts.magic_program.to_account_info(),
    )?;
    Ok(())
}
