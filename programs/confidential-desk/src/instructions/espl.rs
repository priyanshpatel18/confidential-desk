//! Ephemeral SPL (ESPL) bootstrap for desk-owned token accounts. JS `delegateSpl` cannot use an
//! off-curve desk PDA as `owner`; these base-layer instructions mirror the SDK flow so pool vault
//! and LP mint paths are writable on PER (see `magicblock-engine-examples/spl-tokens`).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::system_program;
use anchor_spl::associated_token::{
    get_associated_token_address_with_program_id, AssociatedToken,
};
use anchor_spl::token_interface::{Mint as InterfaceMint, TokenAccount as InterfaceTokenAccount, TokenInterface};
use ephemeral_rollups_sdk::pda::{
    delegate_buffer_pda_from_delegated_account_and_owner_program,
    delegation_metadata_pda_from_delegated_account,
    delegation_record_pda_from_delegated_account,
};

use crate::errors::DeskError;
use crate::{BootstrapDeskBorrowMintEspl, BootstrapDeskLpMintEspl, DESK_SEED};

/// `SPLxh1…` (Ephemeral SPL token program).
const ESPL: Pubkey = pubkey!("SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2");
/// `DELeGG…` (MagicBlock delegation program).
const DEL: Pubkey = pubkey!("DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh");

/// ESPL `initialize_ephemeral_ata`: data is discriminator `0` only (bump lives on-chain).
fn ix_init_ephemeral_ata(eata: Pubkey, payer: Pubkey, user: Pubkey, mint: Pubkey) -> Instruction {
    Instruction {
        program_id: ESPL,
        accounts: vec![
            AccountMeta::new(eata, false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(user, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: vec![0u8],
    }
}

/// ESPL `initialize_global_vault`: vault, payer, mint, vault_ephemeral_ata, vault_token, …
fn ix_init_global_vault(
    vault: Pubkey,
    payer: Pubkey,
    mint: Pubkey,
    vault_ephemeral_ata: Pubkey,
    vault_token: Pubkey,
    spl_token_program: Pubkey,
) -> Instruction {
    Instruction {
        program_id: ESPL,
        accounts: vec![
            AccountMeta::new(vault, false),
            AccountMeta::new(payer, true),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(vault_ephemeral_ata, false),
            AccountMeta::new(vault_token, false),
            AccountMeta::new_readonly(spl_token_program, false),
            AccountMeta::new_readonly(AssociatedToken::id(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: vec![1u8],
    }
}

fn ix_deposit_spl_tokens(
    eata: Pubkey,
    global_vault: Pubkey,
    mint: Pubkey,
    source: Pubkey,
    vault_ata: Pubkey,
    authority: Pubkey,
    spl_token_program: Pubkey,
    amount: u64,
) -> Instruction {
    let mut data = Vec::with_capacity(9);
    data.push(2u8);
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: ESPL,
        accounts: vec![
            AccountMeta::new(eata, false),
            AccountMeta::new_readonly(global_vault, false),
            AccountMeta::new_readonly(mint, false),
            AccountMeta::new(source, false),
            AccountMeta::new(vault_ata, false),
            AccountMeta::new_readonly(authority, true),
            AccountMeta::new_readonly(spl_token_program, false),
        ],
        data,
    }
}

/// After discriminator `4`, ESPL expects **empty** data or **exactly 32** validator pubkey bytes.
fn ix_delegate_ephemeral_ata(
    payer: Pubkey,
    eata: Pubkey,
    delegation_buffer: Pubkey,
    delegation_record: Pubkey,
    delegation_metadata: Pubkey,
    validator: Option<Pubkey>,
) -> Instruction {
    let mut data = Vec::with_capacity(33);
    data.push(4u8);
    if let Some(v) = validator {
        data.extend_from_slice(v.as_ref());
    }
    Instruction {
        program_id: ESPL,
        accounts: vec![
            AccountMeta::new(payer, true),
            AccountMeta::new(eata, false),
            AccountMeta::new_readonly(ESPL, false),
            AccountMeta::new(delegation_buffer, false),
            AccountMeta::new(delegation_record, false),
            AccountMeta::new(delegation_metadata, false),
            AccountMeta::new_readonly(DEL, false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    }
}

fn run_espl_bootstrap_for_mint<'info>(
    authority: &Signer<'info>,
    desk: &Account<'info, crate::state::desk::DeskConfig>,
    mint_acc: &InterfaceAccount<'info, InterfaceMint>,
    source_token_account: &InterfaceAccount<'info, InterfaceTokenAccount>,
    eata: &UncheckedAccount<'info>,
    global_vault: &UncheckedAccount<'info>,
    vault_ephemeral_ata: &UncheckedAccount<'info>,
    global_vault_ata: &UncheckedAccount<'info>,
    delegation_buffer: &UncheckedAccount<'info>,
    delegation_record: &UncheckedAccount<'info>,
    delegation_metadata: &UncheckedAccount<'info>,
    espl_token_program: &UncheckedAccount<'info>,
    delegation_program: &UncheckedAccount<'info>,
    token_program: &Interface<'info, TokenInterface>,
    associated_token_program: &Program<'info, AssociatedToken>,
    system_program: &Program<'info, System>,
    validator: Option<Pubkey>,
) -> Result<()> {
    let mint = mint_acc.key();
    let desk_key = desk.key();
    let spl_pid = token_program.key();
    require_keys_eq!(source_token_account.mint, mint, DeskError::Unauthorized);
    require_keys_eq!(source_token_account.owner, desk_key, DeskError::Unauthorized);

    let (eata_expected, _eata_bump) =
        Pubkey::find_program_address(&[desk_key.as_ref(), mint.as_ref()], &ESPL);
    require_keys_eq!(eata_expected, eata.key(), DeskError::Unauthorized);

    let (gv_expected, _gv_bump) = Pubkey::find_program_address(&[mint.as_ref()], &ESPL);
    require_keys_eq!(gv_expected, global_vault.key(), DeskError::Unauthorized);

    let gv_ata_expected =
        get_associated_token_address_with_program_id(&global_vault.key(), &mint, &spl_pid);
    require_keys_eq!(gv_ata_expected, global_vault_ata.key(), DeskError::Unauthorized);

    let (vault_eata_expected, _) = Pubkey::find_program_address(
        &[global_vault.key().as_ref(), mint.as_ref()],
        &ESPL,
    );
    require_keys_eq!(
        vault_eata_expected,
        vault_ephemeral_ata.key(),
        DeskError::Unauthorized
    );

    let buf = delegate_buffer_pda_from_delegated_account_and_owner_program(&eata_expected, &ESPL);
    require_keys_eq!(buf, delegation_buffer.key(), DeskError::Unauthorized);
    let rec = delegation_record_pda_from_delegated_account(&eata_expected);
    require_keys_eq!(rec, delegation_record.key(), DeskError::Unauthorized);
    let meta = delegation_metadata_pda_from_delegated_account(&eata_expected);
    require_keys_eq!(meta, delegation_metadata.key(), DeskError::Unauthorized);

    require_keys_eq!(espl_token_program.key(), ESPL, DeskError::Unauthorized);
    require_keys_eq!(delegation_program.key(), DEL, DeskError::Unauthorized);
    require_keys_eq!(
        associated_token_program.key(),
        AssociatedToken::id(),
        DeskError::Unauthorized
    );

    let desk_seeds: &[&[u8]] = &[
        DESK_SEED,
        desk.collateral_mint.as_ref(),
        desk.borrow_mint.as_ref(),
        &[desk.bump],
    ];
    let signers: &[&[&[u8]]] = &[desk_seeds];
    let desk_ai = desk.to_account_info();

    invoke(
        &ix_init_ephemeral_ata(eata_expected, authority.key(), desk_key, mint),
        &[
            eata.to_account_info(),
            authority.to_account_info(),
            desk_ai.clone(),
            mint_acc.to_account_info(),
            system_program.to_account_info(),
        ],
    )
    .map_err(|_| error!(DeskError::Unauthorized))?;

    invoke(
        &ix_init_global_vault(
            gv_expected,
            authority.key(),
            mint,
            vault_eata_expected,
            gv_ata_expected,
            spl_pid,
        ),
        &[
            global_vault.to_account_info(),
            authority.to_account_info(),
            mint_acc.to_account_info(),
            vault_ephemeral_ata.to_account_info(),
            global_vault_ata.to_account_info(),
            token_program.to_account_info(),
            associated_token_program.to_account_info(),
            system_program.to_account_info(),
        ],
    )
    .map_err(|_| error!(DeskError::Unauthorized))?;

    invoke_signed(
        &ix_deposit_spl_tokens(
            eata_expected,
            gv_expected,
            mint,
            source_token_account.key(),
            gv_ata_expected,
            desk_key,
            spl_pid,
            0,
        ),
        &[
            eata.to_account_info(),
            global_vault.to_account_info(),
            mint_acc.to_account_info(),
            source_token_account.to_account_info(),
            global_vault_ata.to_account_info(),
            desk_ai.clone(),
            token_program.to_account_info(),
        ],
        signers,
    )
    .map_err(|_| error!(DeskError::Unauthorized))?;

    invoke(
        &ix_delegate_ephemeral_ata(
            authority.key(),
            eata_expected,
            buf,
            rec,
            meta,
            validator,
        ),
        &[
            authority.to_account_info(),
            eata.to_account_info(),
            espl_token_program.to_account_info(),
            delegation_buffer.to_account_info(),
            delegation_record.to_account_info(),
            delegation_metadata.to_account_info(),
            delegation_program.to_account_info(),
            system_program.to_account_info(),
        ],
    )
    .map_err(|_| error!(DeskError::Unauthorized))?;

    Ok(())
}

pub fn bootstrap_desk_borrow_mint_espl_handler(
    ctx: Context<BootstrapDeskBorrowMintEspl>,
    validator: Option<Pubkey>,
) -> Result<()> {
    run_espl_bootstrap_for_mint(
        &ctx.accounts.authority,
        &ctx.accounts.desk,
        &ctx.accounts.borrow_mint,
        &ctx.accounts.borrow_vault,
        &ctx.accounts.eata,
        &ctx.accounts.global_vault,
        &ctx.accounts.vault_ephemeral_ata,
        &ctx.accounts.global_vault_ata,
        &ctx.accounts.delegation_buffer,
        &ctx.accounts.delegation_record,
        &ctx.accounts.delegation_metadata,
        &ctx.accounts.espl_token_program,
        &ctx.accounts.delegation_program,
        &ctx.accounts.token_program,
        &ctx.accounts.associated_token_program,
        &ctx.accounts.system_program,
        validator,
    )
}

pub fn bootstrap_desk_lp_mint_espl_handler(
    ctx: Context<BootstrapDeskLpMintEspl>,
    validator: Option<Pubkey>,
) -> Result<()> {
    run_espl_bootstrap_for_mint(
        &ctx.accounts.authority,
        &ctx.accounts.desk,
        &ctx.accounts.lp_mint,
        &ctx.accounts.desk_lp_ata,
        &ctx.accounts.eata,
        &ctx.accounts.global_vault,
        &ctx.accounts.vault_ephemeral_ata,
        &ctx.accounts.global_vault_ata,
        &ctx.accounts.delegation_buffer,
        &ctx.accounts.delegation_record,
        &ctx.accounts.delegation_metadata,
        &ctx.accounts.espl_token_program,
        &ctx.accounts.delegation_program,
        &ctx.accounts.token_program,
        &ctx.accounts.associated_token_program,
        &ctx.accounts.system_program,
        validator,
    )
}
