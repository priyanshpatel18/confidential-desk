use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};
use anchor_spl::token_interface::{Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount, TokenInterface};
use ephemeral_rollups_sdk::anchor::delegate;
use ephemeral_rollups_sdk::consts::{MAGIC_CONTEXT_ID, MAGIC_PROGRAM_ID, PERMISSION_PROGRAM_ID};

use crate::state::desk::DeskConfig;
use crate::state::ledger::DeskLedger;
use crate::state::position::{BorrowerPosition, LenderPosition};
use crate::{
    BORROWER_SEED, DESK_SEED, LEDGER_SEED, LENDER_SEED, LP_MINT_SEED,
};

#[derive(Accounts)]
pub struct InitializeDesk<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + DeskConfig::LEN,
        seeds = [DESK_SEED, collateral_mint.key().as_ref(), borrow_mint.key().as_ref()],
        bump
    )]
    pub desk: Account<'info, DeskConfig>,
    pub collateral_mint: Account<'info, Mint>,
    pub borrow_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        mint::decimals = borrow_mint.decimals,
        mint::authority = desk,
        mint::freeze_authority = desk,
        seeds = [LP_MINT_SEED, collateral_mint.key().as_ref(), borrow_mint.key().as_ref()],
        bump
    )]
    pub lp_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = 8 + DeskLedger::LEN,
        seeds = [LEDGER_SEED, desk.key().as_ref()],
        bump
    )]
    pub desk_ledger: Account<'info, DeskLedger>,
    /// CHECK: MagicBlock permission PDA for desk ledger.
    #[account(mut)]
    pub permission_desk_ledger: UncheckedAccount<'info>,
    /// CHECK: MagicBlock Permission Program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Create protocol vault ATAs on base (idempotent). `desk` must be `mut` for ATA init_if_needed CPIs.
#[derive(Accounts)]
pub struct InitDeskVaults<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump,
    )]
    pub desk: Account<'info, DeskConfig>,
    pub collateral_mint: Account<'info, Mint>,
    pub borrow_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = collateral_mint,
        associated_token::authority = desk,
    )]
    pub collateral_vault: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = borrow_mint,
        associated_token::authority = desk,
    )]
    pub borrow_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Base-only: register desk + borrow mint with Ephemeral SPL so `borrow_vault` is writable on PER.
#[derive(Accounts)]
pub struct BootstrapDeskBorrowMintEspl<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump,
        constraint = desk.authority == authority.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        constraint = borrow_mint.key() == desk.borrow_mint @ crate::errors::DeskError::Unauthorized,
        constraint = *borrow_mint.to_account_info().owner == token_program.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub borrow_mint: InterfaceAccount<'info, InterfaceMint>,
    #[account(
        mut,
        address = desk.borrow_vault,
        constraint = borrow_vault.owner == desk.key(),
        constraint = borrow_vault.mint == desk.borrow_mint,
        constraint = *borrow_vault.to_account_info().owner == token_program.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub borrow_vault: InterfaceAccount<'info, InterfaceTokenAccount>,
    /// CHECK: ESPL ephemeral ATA PDA [desk, borrow_mint]
    #[account(mut)]
    pub eata: UncheckedAccount<'info>,
    /// CHECK: ESPL global vault PDA [borrow_mint]
    #[account(mut)]
    pub global_vault: UncheckedAccount<'info>,
    /// CHECK: ESPL ephemeral ATA PDA [global_vault, borrow_mint] (required by current ESPL `initialize_global_vault`)
    #[account(mut)]
    pub vault_ephemeral_ata: UncheckedAccount<'info>,
    /// CHECK: ATA(global_vault, borrow_mint)
    #[account(mut)]
    pub global_vault_ata: UncheckedAccount<'info>,
    /// CHECK: delegation buffer for `eata`
    #[account(mut)]
    pub delegation_buffer: UncheckedAccount<'info>,
    /// CHECK: delegation record for `eata`
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: delegation metadata for `eata`
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: ESPL token program
    pub espl_token_program: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program
    pub delegation_program: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Base-only: register desk + LP mint with Ephemeral SPL so `lp_mint` / desk LP flows work on PER.
#[derive(Accounts)]
pub struct BootstrapDeskLpMintEspl<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump,
        constraint = desk.authority == authority.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        constraint = lp_mint.key() == desk.lp_mint @ crate::errors::DeskError::Unauthorized,
        constraint = *lp_mint.to_account_info().owner == token_program.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub lp_mint: InterfaceAccount<'info, InterfaceMint>,
    pub token_program: Interface<'info, TokenInterface>,
    #[account(
        init_if_needed,
        payer = authority,
        associated_token::mint = lp_mint,
        associated_token::authority = desk,
        associated_token::token_program = token_program,
    )]
    pub desk_lp_ata: InterfaceAccount<'info, InterfaceTokenAccount>,
    /// CHECK: ESPL ephemeral ATA PDA [desk, lp_mint]
    #[account(mut)]
    pub eata: UncheckedAccount<'info>,
    /// CHECK: ESPL global vault PDA [lp_mint]
    #[account(mut)]
    pub global_vault: UncheckedAccount<'info>,
    /// CHECK: ESPL ephemeral ATA PDA [global_vault, lp_mint]
    #[account(mut)]
    pub vault_ephemeral_ata: UncheckedAccount<'info>,
    /// CHECK: ATA(global_vault, lp_mint)
    #[account(mut)]
    pub global_vault_ata: UncheckedAccount<'info>,
    /// CHECK: delegation buffer for `eata`
    #[account(mut)]
    pub delegation_buffer: UncheckedAccount<'info>,
    /// CHECK: delegation record for `eata`
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: delegation metadata for `eata`
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: ESPL token program
    pub espl_token_program: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program
    pub delegation_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateOracle<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
}

#[derive(Accounts)]
pub struct OpenBorrower<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        init,
        payer = owner,
        space = 8 + BorrowerPosition::LEN,
        seeds = [BORROWER_SEED, desk.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub borrower_position: Account<'info, BorrowerPosition>,
    /// CHECK: MagicBlock permission PDA for borrower position.
    #[account(mut)]
    pub permission_borrower: UncheckedAccount<'info>,
    /// CHECK: MagicBlock Permission Program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateBorrowerPda<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    /// CHECK: Borrower position PDA to delegate to ER.
    #[account(
        mut,
        del,
        seeds = [BORROWER_SEED, desk.key().as_ref(), payer.key().as_ref()],
        bump
    )]
    pub pda: AccountInfo<'info>,
    /// CHECK: Optional ER validator identity account.
    pub validator: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
pub struct DepositCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        mut,
        seeds = [BORROWER_SEED, desk.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub borrower_position: Account<'info, BorrowerPosition>,
    #[account(mut, address = desk.collateral_vault)]
    pub collateral_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_collateral_ata.owner == owner.key(),
        constraint = user_collateral_ata.mint == desk.collateral_mint
    )]
    pub user_collateral_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        mut,
        seeds = [LEDGER_SEED, desk.key().as_ref()],
        bump,
        constraint = desk_ledger.desk == desk.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub desk_ledger: Account<'info, DeskLedger>,
    #[account(
        mut,
        seeds = [BORROWER_SEED, desk.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub borrower_position: Account<'info, BorrowerPosition>,
    #[account(mut, address = desk.borrow_vault)]
    pub borrow_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_borrow_ata.owner == owner.key(),
        constraint = user_borrow_ata.mint == desk.borrow_mint
    )]
    pub user_borrow_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Repay<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        mut,
        seeds = [LEDGER_SEED, desk.key().as_ref()],
        bump,
        constraint = desk_ledger.desk == desk.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub desk_ledger: Account<'info, DeskLedger>,
    #[account(
        mut,
        seeds = [BORROWER_SEED, desk.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub borrower_position: Account<'info, BorrowerPosition>,
    #[account(mut, address = desk.borrow_vault)]
    pub borrow_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_borrow_ata.owner == owner.key(),
        constraint = user_borrow_ata.mint == desk.borrow_mint
    )]
    pub user_borrow_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        mut,
        seeds = [BORROWER_SEED, desk.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub borrower_position: Account<'info, BorrowerPosition>,
    #[account(mut, address = desk.collateral_vault)]
    pub collateral_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_collateral_ata.owner == owner.key(),
        constraint = user_collateral_ata.mint == desk.collateral_mint
    )]
    pub user_collateral_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateDeskLedgerPda<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump,
        constraint = desk.authority == payer.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub desk: Account<'info, DeskConfig>,
    /// CHECK: DeskLedger PDA to delegate to ER.
    #[account(mut, del, seeds = [LEDGER_SEED, desk.key().as_ref()], bump)]
    pub pda: AccountInfo<'info>,
    /// CHECK: Optional ER validator identity account.
    pub validator: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
pub struct OpenLender<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        init,
        payer = owner,
        space = 8 + LenderPosition::LEN,
        seeds = [LENDER_SEED, desk.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub lender_position: Account<'info, LenderPosition>,
    /// CHECK: MagicBlock permission PDA for lender position.
    #[account(mut)]
    pub permission_lender: UncheckedAccount<'info>,
    /// CHECK: MagicBlock Permission Program.
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateLenderPda<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    /// CHECK: Lender position PDA to delegate to ER.
    #[account(
        mut,
        del,
        seeds = [LENDER_SEED, desk.key().as_ref(), payer.key().as_ref()],
        bump
    )]
    pub pda: AccountInfo<'info>,
    /// CHECK: Optional ER validator identity account.
    pub validator: Option<AccountInfo<'info>>,
}

#[derive(Accounts)]
pub struct DepositLiquidity<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,
    /// Read-only on PER: desk config is mirrored from base; only delegated PDAs + token accounts are writable.
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        mut,
        seeds = [LEDGER_SEED, desk.key().as_ref()],
        bump,
        constraint = desk_ledger.desk == desk.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub desk_ledger: Account<'info, DeskLedger>,
    #[account(
        mut,
        seeds = [LENDER_SEED, desk.key().as_ref(), lender.key().as_ref()],
        bump,
    )]
    pub lender_position: Account<'info, LenderPosition>,
    #[account(mut, address = desk.borrow_vault)]
    pub borrow_vault: Account<'info, TokenAccount>,
    #[account(mut, address = desk.lp_mint)]
    pub lp_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = lender_borrow_ata.owner == lender.key(),
        constraint = lender_borrow_ata.mint == desk.borrow_mint
    )]
    pub lender_borrow_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = lender_lp_ata.owner == lender.key(),
        constraint = lender_lp_ata.mint == lp_mint.key()
    )]
    pub lender_lp_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawLp<'info> {
    #[account(mut)]
    pub lender: Signer<'info>,
    /// Read-only on PER: desk config mirror (same as `DepositLiquidity`).
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        mut,
        seeds = [LEDGER_SEED, desk.key().as_ref()],
        bump,
        constraint = desk_ledger.desk == desk.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub desk_ledger: Account<'info, DeskLedger>,
    #[account(
        mut,
        seeds = [LENDER_SEED, desk.key().as_ref(), lender.key().as_ref()],
        bump,
    )]
    pub lender_position: Account<'info, LenderPosition>,
    #[account(mut, address = desk.borrow_vault)]
    pub borrow_vault: Account<'info, TokenAccount>,
    #[account(mut, address = desk.lp_mint)]
    pub lp_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = lender_borrow_ata.owner == lender.key(),
        constraint = lender_borrow_ata.mint == desk.borrow_mint
    )]
    pub lender_borrow_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = lender_lp_ata.owner == lender.key(),
        constraint = lender_lp_ata.mint == lp_mint.key()
    )]
    pub lender_lp_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct HealthTickBorrower<'info> {
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        mut,
        seeds = [BORROWER_SEED, desk.key().as_ref(), borrower_position.owner.as_ref()],
        bump,
    )]
    pub borrower_position: Account<'info, BorrowerPosition>,
}

#[derive(Accounts)]
pub struct ScheduleHealthCrankDesk<'info> {
    /// CHECK: Magic program for crank scheduling.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub position_owner: Signer<'info>,
    /// CHECK: Delegated borrower position (opaque AccountInfo for Magic scheduler).
    #[account(mut)]
    pub borrower_position: AccountInfo<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    /// CHECK: This program id for scheduled ix payload.
    #[account(address = crate::ID)]
    pub program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct LiquidatePer<'info> {
    #[account(mut)]
    pub liquidator: Signer<'info>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    #[account(
        mut,
        seeds = [LEDGER_SEED, desk.key().as_ref()],
        bump,
        constraint = desk_ledger.desk == desk.key() @ crate::errors::DeskError::Unauthorized
    )]
    pub desk_ledger: Account<'info, DeskLedger>,
    #[account(
        mut,
        seeds = [BORROWER_SEED, desk.key().as_ref(), borrower_position.owner.as_ref()],
        bump,
    )]
    pub borrower_position: Account<'info, BorrowerPosition>,
    #[account(mut, address = desk.borrow_vault)]
    pub borrow_vault: Account<'info, TokenAccount>,
    #[account(mut, address = desk.collateral_vault)]
    pub collateral_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = liquidator_borrow_ata.owner == liquidator.key(),
        constraint = liquidator_borrow_ata.mint == desk.borrow_mint
    )]
    pub liquidator_borrow_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = liquidator_collateral_ata.owner == liquidator.key(),
        constraint = liquidator_collateral_ata.mint == desk.collateral_mint
    )]
    pub liquidator_collateral_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseBorrowerPositionPer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [BORROWER_SEED, desk.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub borrower_position: Account<'info, BorrowerPosition>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    /// CHECK: Magic context for commit_and_undelegate CPI.
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: Magic program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseLenderPositionPer<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [LENDER_SEED, desk.key().as_ref(), owner.key().as_ref()],
        bump,
    )]
    pub lender_position: Account<'info, LenderPosition>,
    #[account(
        seeds = [DESK_SEED, desk.collateral_mint.as_ref(), desk.borrow_mint.as_ref()],
        bump = desk.bump
    )]
    pub desk: Account<'info, DeskConfig>,
    /// CHECK: Magic context for commit_and_undelegate CPI.
    #[account(mut, address = MAGIC_CONTEXT_ID)]
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: Magic program.
    #[account(address = MAGIC_PROGRAM_ID)]
    pub magic_program: UncheckedAccount<'info>,
}
