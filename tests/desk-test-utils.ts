import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { readFileSync } from "fs";
import { join } from "path";
import type { ConfidentialDesk } from "../target/types/confidential_desk";

export const idl = JSON.parse(
  readFileSync(
    join(process.cwd(), "target/idl/confidential_desk.json"),
    "utf8",
  ),
) as ConfidentialDesk;

export const DESK_SEED = Buffer.from("desk");
export const BORROWER_SEED = Buffer.from("borrower");
export const LENDER_SEED = Buffer.from("lender");
export const LP_MINT_SEED = Buffer.from("lp_mint");
export const LEDGER_SEED = Buffer.from("ledger");

export const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
);
export const MAGIC_BLOCK_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111",
);

export const D = 6;
export const PRICE_Q12 = new BN(1_000_000_000_000);
export const INTEREST_BPS = 500;
export const LTV_MAX_BPS = 8000;
export const LIQ_THRESHOLD_BPS = 8500;
export const LIQ_BONUS_BPS = 500;

export type DeskCtx = {
  program: Program<ConfidentialDesk>;
  provider: anchor.AnchorProvider;
  payer: Keypair;
  connection: anchor.web3.Connection;
  collateralMint: Keypair;
  borrowMint: Keypair;
  deskPda: PublicKey;
  deskLedgerPda: PublicKey;
  lpMintPda: PublicKey;
  collateralVault: PublicKey;
  borrowVault: PublicKey;
};

export function deriveBorrower(
  programId: PublicKey,
  desk: PublicKey,
  owner: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [BORROWER_SEED, desk.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

export function deriveLender(programId: PublicKey, desk: PublicKey, owner: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [LENDER_SEED, desk.toBuffer(), owner.toBuffer()],
    programId,
  )[0];
}

function computeLpMinted(
  amount: BN,
  ledgerTotalDepositsBefore: BN,
  ledgerLpTotalBefore: BN,
): BN {
  if (ledgerTotalDepositsBefore.isZero() || ledgerLpTotalBefore.isZero()) {
    return amount;
  }
  return amount.mul(ledgerLpTotalBefore).div(ledgerTotalDepositsBefore);
}

/** Fund pool via `deposit_liquidity` (PER-native; runs on localnet validator in tests). */
export async function seedPoolWithLenderDeposit(
  ctx: DeskCtx,
  owner: PublicKey,
  depositAmount: BN,
) {
  const programId = ctx.program.programId;
  const lenderPda = deriveLender(programId, ctx.deskPda, owner);
  const lenderInfo = await ctx.connection.getAccountInfo(lenderPda);
  if (!lenderInfo) {
    await ctx.program.methods
      .openLender()
      .accountsPartial({
        owner,
        desk: ctx.deskPda,
        lenderPosition: lenderPda,
        permissionLender: permissionPdaFromAccount(lenderPda),
        permissionProgram: PERMISSION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }
  const lenderBorrowAta = await ensureAta(
    ctx.connection,
    ctx.payer,
    owner,
    ctx.borrowMint.publicKey,
  );
  const lenderLpAta = await ensureAta(
    ctx.connection,
    ctx.payer,
    owner,
    ctx.lpMintPda,
  );
  const ledger = await ctx.program.account.deskLedger.fetch(ctx.deskLedgerPda);
  const lpMinted = computeLpMinted(
    depositAmount,
    new BN(ledger.totalDeposits.toString()),
    new BN(ledger.lpTotalMinted.toString()),
  );
  await ctx.program.methods
    .depositLiquidity(depositAmount, lpMinted)
    .accountsPartial({
      lender: owner,
      desk: ctx.deskPda,
      deskLedger: ctx.deskLedgerPda,
      lenderPosition: lenderPda,
      borrowVault: ctx.borrowVault,
      lpMint: ctx.lpMintPda,
      lenderBorrowAta,
      lenderLpAta,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
}

export async function setupDesk(): Promise<DeskCtx> {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const payer = (provider.wallet as anchor.Wallet).payer;
  const connection = provider.connection;

  const program = new Program(
    idl as ConfidentialDesk,
    provider,
  ) as Program<ConfidentialDesk>;

  const collateralMint = Keypair.generate();
  const borrowMint = Keypair.generate();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: collateralMint.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      collateralMint.publicKey,
      D,
      payer.publicKey,
      null,
    ),
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: borrowMint.publicKey,
      space: MINT_SIZE,
      lamports: mintRent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      borrowMint.publicKey,
      D,
      payer.publicKey,
      null,
    ),
  );
  await sendAndConfirmTransaction(connection, tx, [payer, collateralMint, borrowMint]);

  const deskPda = PublicKey.findProgramAddressSync(
    [DESK_SEED, collateralMint.publicKey.toBuffer(), borrowMint.publicKey.toBuffer()],
    program.programId,
  )[0];
  const deskLedgerPda = PublicKey.findProgramAddressSync(
    [LEDGER_SEED, deskPda.toBuffer()],
    program.programId,
  )[0];
  const lpMintPda = PublicKey.findProgramAddressSync(
    [
      LP_MINT_SEED,
      collateralMint.publicKey.toBuffer(),
      borrowMint.publicKey.toBuffer(),
    ],
    program.programId,
  )[0];
  const collateralVault = getAssociatedTokenAddressSync(
    collateralMint.publicKey,
    deskPda,
    true,
  );
  const borrowVault = getAssociatedTokenAddressSync(
    borrowMint.publicKey,
    deskPda,
    true,
  );

  await program.methods
    .initializeDesk(
      INTEREST_BPS,
      LTV_MAX_BPS,
      LIQ_THRESHOLD_BPS,
      LIQ_BONUS_BPS,
      PRICE_Q12,
    )
    .accountsPartial({
      authority: payer.publicKey,
      desk: deskPda,
      collateralMint: collateralMint.publicKey,
      borrowMint: borrowMint.publicKey,
      lpMint: lpMintPda,
      deskLedger: deskLedgerPda,
      permissionDeskLedger: permissionPdaFromAccount(deskLedgerPda),
      permissionProgram: PERMISSION_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  await program.methods
    .initDeskVaults()
    .accountsPartial({
      payer: payer.publicKey,
      desk: deskPda,
      collateralMint: collateralMint.publicKey,
      borrowMint: borrowMint.publicKey,
      collateralVault,
      borrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  return {
    program,
    provider,
    payer,
    connection,
    collateralMint,
    borrowMint,
    deskPda,
    deskLedgerPda,
    lpMintPda,
    collateralVault,
    borrowVault,
  };
}

export async function ensureAta(
  connection: anchor.web3.Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        createAssociatedTokenAccountInstruction(
          payer.publicKey,
          ata,
          owner,
          mint,
        ),
      ),
      [payer],
    );
  }
  return ata;
}

export async function fundLamportsFromPayer(
  connection: anchor.web3.Connection,
  payer: Keypair,
  recipient: PublicKey,
  lamports: number,
) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports,
    }),
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  await sendAndConfirmTransaction(connection, tx, [payer]);
}
