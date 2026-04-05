use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::DeskError;
use crate::state::{BorrowerPosition, DeskConfig};
use crate::PRICE_SCALE;

/// Desk instructions CPI the SPL Token program only; debits must be covered by the passed-in ATA.
pub(crate) fn require_spl_ata_balance_at_least(
    token_account: &Account<TokenAccount>,
    needed: u64,
) -> Result<()> {
    require!(
        token_account.amount >= needed,
        DeskError::InsufficientRollupSplAta
    );
    Ok(())
}

pub(crate) fn collateral_value_atoms(collateral: u64, price_q12: u64) -> Result<u128> {
    let num = u128::from(collateral)
        .checked_mul(u128::from(price_q12))
        .ok_or_else(|| error!(DeskError::MathOverflow))?;
    num.checked_div(PRICE_SCALE)
        .ok_or_else(|| error!(DeskError::MathOverflow))
}

pub(crate) fn max_debt_for_collateral(
    collateral: u64,
    price_q12: u64,
    ltv_max_bps: u16,
) -> Result<u64> {
    let cv = collateral_value_atoms(collateral, price_q12)?;
    let max = cv
        .checked_mul(u128::from(ltv_max_bps))
        .ok_or(DeskError::MathOverflow)?
        .checked_div(10000)
        .ok_or(DeskError::MathOverflow)?;
    u64::try_from(max).map_err(|_| error!(DeskError::MathOverflow))
}

pub(crate) fn is_underwater(position: &BorrowerPosition, desk: &DeskConfig) -> bool {
    if position.debt_amount == 0 {
        return false;
    }
    let Ok(cv) = collateral_value_atoms(position.collateral_amount, desk.collateral_price_q12) else {
        return true;
    };
    if cv == 0 {
        return true;
    }
    u128::from(position.debt_amount)
        .checked_mul(10000)
        .map(|x| x > cv.checked_mul(u128::from(desk.liquidation_threshold_bps)).unwrap_or(0))
        .unwrap_or(true)
}

pub(crate) fn accrue_interest_borrower(
    position: &mut BorrowerPosition,
    desk: &DeskConfig,
) -> Result<()> {
    if position.debt_amount == 0 {
        position.last_accrual_ts = Clock::get()?.unix_timestamp;
        return Ok(());
    }
    let now = Clock::get()?.unix_timestamp;
    let dt = now.saturating_sub(position.last_accrual_ts);
    if dt <= 0 {
        return Ok(());
    }
    let growth = u128::from(position.debt_amount)
        .checked_mul(u128::from(desk.interest_rate_bps))
        .ok_or(DeskError::MathOverflow)?
        .checked_mul(dt as u128)
        .ok_or(DeskError::MathOverflow)?
        .checked_div(10000)
        .ok_or(DeskError::MathOverflow)?
        .checked_div(365 * 24 * 3600)
        .ok_or(DeskError::MathOverflow)?;
    let g = u64::try_from(growth).map_err(|_| error!(DeskError::MathOverflow))?;
    position.debt_amount = position
        .debt_amount
        .checked_add(g)
        .ok_or(DeskError::MathOverflow)?;
    position.last_accrual_ts = now;
    Ok(())
}
