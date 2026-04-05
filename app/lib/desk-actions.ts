import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  createDelegatePermissionInstruction,
  DELEGATION_PROGRAM_ID,
  delegateSpl,
  delegateSplIdempotent,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  permissionPdaFromAccount,
  PERMISSION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import type { AnchorWallet } from "@solana/wallet-adapter-react";

import { borrowLog } from "@/lib/haven-borrow-debug";
import {
  deskContext,
  deriveBorrowerPositionPda,
  deriveDeskLedgerPda,
  deriveDeskPda,
  deriveLenderPositionPda,
  resolveDelegateValidatorPk,
} from "@/lib/desk-config";
import { createDeskProgram } from "@/lib/desk-program";
import { sendSignedEphemeralTx } from "@/lib/desk-rollup";
import {
  assertEphemeralRollupMatchesCluster,
  waitRollupPermissionOrThrow,
} from "@/lib/ephemeral-rollup-guards";
import { getEphemeralConnectionForBorrow } from "@/lib/ephemeral-connection";
import { getBorrowMint, getCollateralMint } from "@/lib/haven-config";
import { getPublicEphemeralRpc, getPublicEphemeralWs } from "@/lib/per-public";

const LEGACY_TX_PACK_TARGET_BYTES = 1040;

type DeskConfigAccount = {
  authority: PublicKey;
  collateralMint: PublicKey;
  borrowMint: PublicKey;
  collateralVault: PublicKey;
  borrowVault: PublicKey;
  lpMint: PublicKey;
  collateralPriceQ12: BN;
  ltvMaxBps: number;
};

type DeskConfigClient = { fetch: (p: PublicKey) => Promise<DeskConfigAccount> };

function deskConfigClient(program: Program): DeskConfigClient {
  return (program.account as unknown as { deskConfig: DeskConfigClient })
    .deskConfig;
}

function maxInstructionsFitLegacyTx(
  feePayer: PublicKey,
  blockhash: string,
  instructions: TransactionInstruction[],
  maxBytes: number,
): number {
  if (instructions.length === 0) return 0;
  let lo = 1;
  let hi = instructions.length;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const tx = new Transaction();
    tx.feePayer = feePayer;
    tx.recentBlockhash = blockhash;
    tx.add(...instructions.slice(0, mid));
    let len: number;
    try {
      len = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).length;
    } catch {
      len = maxBytes + 1;
    }
    if (len <= maxBytes) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function splitInstructionsForLegacyTx(
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
  maxBytes: number,
): TransactionInstruction[][] {
  if (instructions.length === 0) return [];
  const probeHash = "11111111111111111111111111111111";
  const out: TransactionInstruction[][] = [];
  let remaining = [...instructions];
  while (remaining.length > 0) {
    const n = maxInstructionsFitLegacyTx(
      feePayer,
      probeHash,
      remaining,
      maxBytes,
    );
    if (n === 0) {
      throw new Error(
        "Transaction too large: a single instruction exceeds the Solana legacy transaction limit.",
      );
    }
    out.push(remaining.slice(0, n));
    remaining = remaining.slice(n);
  }
  return out;
}

async function sendChunkedBaseTransactions(
  connection: Connection,
  wallet: AnchorWallet,
  instructions: TransactionInstruction[],
  logLabel: string,
): Promise<void> {
  if (instructions.length === 0) return;
  const chunks = splitInstructionsForLegacyTx(
    wallet.publicKey,
    instructions,
    LEGACY_TX_PACK_TARGET_BYTES,
  );
  for (let i = 0; i < chunks.length; i++) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction().add(...chunks[i]);
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: true,
    });
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash,
        lastValidBlockHeight,
      },
      "confirmed",
    );
    borrowLog(`[desk] ${logLabel} base chunk ${i + 1}/${chunks.length}`, {
      signature: sig,
    });
  }
}

/**
 * PER SPL transfers require the same Ephemeral SPL registration as `magicblock-engine-examples/spl-tokens`
 * (delegate on base, then execute on ER). Wallets cannot delegate desk-owned vaults; run
 * `yarn bootstrap-desk-espl-devnet` once per desk as authority.
 */
async function ensureWalletSplForPerOperations(params: {
  connection: Connection;
  wallet: AnchorWallet;
  steps: Array<{ mint: PublicKey; amount: bigint; idempotent?: boolean }>;
}): Promise<void> {
  const { connection, wallet, steps } = params;
  if (steps.length === 0) return;
  const validator = await resolveDelegateValidatorPk(getPublicEphemeralRpc());
  const instructions: TransactionInstruction[] = [];
  for (const step of steps) {
    const baseOpts = { validator, initVaultIfMissing: true as const };
    if (step.idempotent) {
      const ixs = await delegateSplIdempotent(
        wallet.publicKey,
        step.mint,
        step.amount,
        { ...baseOpts, initAtasIfMissing: true },
      );
      instructions.push(...ixs);
    } else {
      const ixs = await delegateSpl(wallet.publicKey, step.mint, step.amount, {
        ...baseOpts,
        initIfMissing: true,
      });
      instructions.push(...ixs);
    }
  }
  await sendChunkedBaseTransactions(
    connection,
    wallet,
    instructions,
    "per_wallet_spl_delegate",
  );
}

export type { PositionData } from "@/lib/haven-actions";

export type LenderPositionData = {
  depositAmount: BN;
  lpShares: BN;
};

export type DeskSummary = {
  authority: PublicKey;
  borrowVault: PublicKey;
  collateralVault: PublicKey;
  lpMint: PublicKey;
  totalBorrowed: BN;
  totalDeposits: BN;
  lpTotalMinted: BN;
  collateralPriceQ12: BN;
  ltvMaxBps: number;
  vaultLiquidityRaw: BN;
};

export const DESK_LEDGER_INACTIVE_PREFIX = "[desk-ledger-inactive]";

export async function isDeskDeployed(
  connection: Connection,
  deskPda: PublicKey,
): Promise<boolean> {
  const info = await connection.getAccountInfo(deskPda, "confirmed");
  return info !== null && info.data.length > 8;
}

function rollupHttpForGuards(): string {
  return getPublicEphemeralRpc();
}

function rollupWsForConnection(): string {
  return getPublicEphemeralWs();
}

type DeskLedgerData = {
  totalDeposits: BN;
  totalBorrowed: BN;
  lpTotalMinted: BN;
};

async function fetchDeskLedgerData(
  deskLedgerPda: PublicKey,
  program: Program,
): Promise<DeskLedgerData> {
  const zero: DeskLedgerData = {
    totalDeposits: new BN(0),
    totalBorrowed: new BN(0),
    lpTotalMinted: new BN(0),
  };
  type LAcc = { fetch: (p: PublicKey) => Promise<Record<string, unknown>> };
  const acc = (program.account as { deskLedger?: LAcc }).deskLedger;
  if (!acc) return zero;
  try {
    const l = await acc.fetch(deskLedgerPda);
    return {
      totalDeposits: new BN(String(l.totalDeposits)),
      totalBorrowed: new BN(String(l.totalBorrowed)),
      lpTotalMinted: new BN(String(l.lpTotalMinted)),
    };
  } catch {
    return zero;
  }
}

async function tokenBalanceOrZero(
  connection: Connection,
  ata: PublicKey,
): Promise<BN> {
  try {
    const r = await connection.getTokenAccountBalance(ata);
    return new BN(r.value.amount);
  } catch {
    return new BN(0);
  }
}

const ROLLUP_SPL_SPEND_EXPLAINER =
  "Desk ops only spend SPL from your Associated Token Account on the rollup (the balance shown as ephemeral/private in the app). " +
  "Finish shielding and wait for settlement, then retry or use a smaller amount.";

/**
 * Fails fast before signing a PER tx if the user’s rollup SPL ATA for `mint` is below `minRaw`.
 * Matches what `deposit_*` / `repay` / `withdraw_lp` actually debit (not e-token program state by itself).
 */
async function assertRollupSplAtaAtLeast(params: {
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  mint: PublicKey;
  minRaw: bigint;
  action: string;
}): Promise<void> {
  const { wallet, signMessage, mint, minRaw, action } = params;
  if (minRaw <= BigInt(0)) {
    return;
  }
  const er = await getErConnection(wallet, signMessage);
  const ata = getAssociatedTokenAddressSync(mint, wallet.publicKey);
  const haveBn = await tokenBalanceOrZero(er, ata);
  const have = BigInt(haveBn.toString());
  if (have < minRaw) {
    throw new Error(
      `${action}: rollup SPL balance too low (need ≥ ${minRaw} raw units on mint ${mint.toBase58()}; ` +
        `ATA ${ata.toBase58()} has ${have}). ${ROLLUP_SPL_SPEND_EXPLAINER}`,
    );
  }
}

export async function fetchDeskSummary(
  program: Program,
  deskPda: PublicKey,
  opts?: { vaultConnection?: Connection },
): Promise<DeskSummary> {
  const conn = opts?.vaultConnection ?? program.provider.connection;
  const desk = await deskConfigClient(program).fetch(deskPda);
  const borrowVault = desk.borrowVault as PublicKey;
  const vaultLiquidityRaw = await tokenBalanceOrZero(conn, borrowVault);
  const deskLedgerPda = deriveDeskLedgerPda(program.programId, deskPda);
  const ledger = await fetchDeskLedgerData(deskLedgerPda, program);
  const rec = desk as Record<string, unknown>;
  return {
    authority: desk.authority as PublicKey,
    borrowVault,
    collateralVault: desk.collateralVault as PublicKey,
    lpMint: desk.lpMint as PublicKey,
    totalBorrowed: ledger.totalBorrowed,
    totalDeposits: ledger.totalDeposits,
    lpTotalMinted: ledger.lpTotalMinted,
    collateralPriceQ12: new BN((rec.collateralPriceQ12 as BN).toString()),
    ltvMaxBps: rec.ltvMaxBps as number,
    vaultLiquidityRaw,
  };
}

export async function fetchDeskSnapshotReadOnly(
  connection: Connection,
  deskPda: PublicKey,
  rawIdl: object,
  vaultConnection?: Connection,
): Promise<DeskSummary | null> {
  const kp = Keypair.generate();
  const noopWallet = {
    publicKey: kp.publicKey,
    signTransaction: async <T extends Transaction>(tx: T) => tx,
    signAllTransactions: async <T extends Transaction>(txs: T[]) => txs,
  } as AnchorWallet;
  const provider = new AnchorProvider(connection, noopWallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
    skipPreflight: true,
  });
  const program = new Program(rawIdl as Idl, provider);
  try {
    return await fetchDeskSummary(program, deskPda, {
      vaultConnection: vaultConnection ?? connection,
    });
  } catch {
    return null;
  }
}

export async function fetchDeskPositionData(
  connection: Connection,
  wallet: AnchorWallet,
  rawIdl: object,
): Promise<import("@/lib/haven-actions").PositionData | null> {
  const program = new Program(
    rawIdl as Idl,
    new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      skipPreflight: true,
    }),
  );
  const programId = program.programId;
  const deskPda = deriveDeskPda(
    programId,
    getCollateralMint(),
    getBorrowMint(),
  );
  const borrowerPda = deriveBorrowerPositionPda(
    programId,
    deskPda,
    wallet.publicKey,
  );
  try {
    const pos = await (
      program.account as {
        borrowerPosition: {
          fetch: (p: PublicKey) => Promise<Record<string, unknown>>;
        };
      }
    ).borrowerPosition.fetch(borrowerPda);
    return {
      collateralAmount: new BN((pos.collateralAmount as BN).toString()),
      debtAmount: new BN((pos.debtAmount as BN).toString()),
      lastAccrualTs: new BN((pos.lastAccrualTs as BN).toString()),
      isLiquidatable: (pos.isLiquidatable as number) === 1,
    };
  } catch {
    return null;
  }
}

export async function fetchLenderPositionData(
  connection: Connection,
  wallet: AnchorWallet,
  rawIdl: object,
): Promise<LenderPositionData | null> {
  const program = new Program(
    rawIdl as Idl,
    new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
      skipPreflight: true,
    }),
  );
  const programId = program.programId;
  const deskPda = deriveDeskPda(
    programId,
    getCollateralMint(),
    getBorrowMint(),
  );
  const lenderPda = deriveLenderPositionPda(
    programId,
    deskPda,
    wallet.publicKey,
  );
  try {
    const pos = await (
      program.account as {
        lenderPosition: {
          fetch: (p: PublicKey) => Promise<Record<string, unknown>>;
        };
      }
    ).lenderPosition.fetch(lenderPda);
    return {
      depositAmount: new BN((pos.depositAmount as BN).toString()),
      lpShares: new BN((pos.lpShares as BN).toString()),
    };
  } catch {
    return null;
  }
}

export function computeLpMintedForDeposit(
  amount: BN,
  ledgerTotalDeposits: BN,
  ledgerLpTotalMinted: BN,
): BN {
  if (ledgerTotalDeposits.isZero() || ledgerLpTotalMinted.isZero()) {
    return amount;
  }
  return amount.mul(ledgerLpTotalMinted).div(ledgerTotalDeposits);
}

function createErDeskProgram(
  erConnection: Connection,
  wallet: AnchorWallet,
  rawIdl: object,
): Program {
  const provider = new AnchorProvider(erConnection, wallet, {
    commitment: "processed",
    preflightCommitment: "processed",
    skipPreflight: true,
  });
  return new Program(rawIdl as Idl, provider);
}

async function getErConnection(
  wallet: AnchorWallet,
  signMessage: (m: Uint8Array) => Promise<Uint8Array>,
): Promise<Connection> {
  const http = getPublicEphemeralRpc();
  const ws = rollupWsForConnection();
  assertEphemeralRollupMatchesCluster(http);
  return getEphemeralConnectionForBorrow(http, ws, wallet.publicKey, signMessage);
}

export async function isDeskLedgerDelegated(
  connection: Connection,
  deskLedgerPda: PublicKey,
): Promise<boolean> {
  const info = await connection.getAccountInfo(deskLedgerPda, "confirmed");
  return info !== null && info.owner.equals(DELEGATION_PROGRAM_ID);
}

/**
 * One-time base-layer tx: create desk vault ATAs (same layer as RPS / sealed-auction base RPC).
 * Never send this instruction to PER — see `desk-rpc-policy.ts`.
 */
export async function initDeskVaults(params: {
  connection: Connection;
  wallet: AnchorWallet;
}): Promise<void> {
  const { connection, wallet } = params;
  const program = createDeskProgram(connection, wallet);
  const { deskPda, collateralMint, borrowMint } = deskContext();
  const cfg = await deskConfigClient(program).fetch(deskPda);
  await program.methods
    .initDeskVaults()
    .accounts({
      payer: wallet.publicKey,
      desk: deskPda,
      collateralMint,
      borrowMint,
      collateralVault: cfg.collateralVault,
      borrowVault: cfg.borrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ skipPreflight: true, commitment: "confirmed" });
}

/**
 * Base layer: open position (if needed), delegate permission + PDA to ER.
 * Desk authority also delegates `desk_ledger` when missing.
 */
export async function activatePosition(params: {
  connection: Connection;
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  kind: "borrower" | "lender";
  onStep?: (label: string | null) => void;
}): Promise<void> {
  const { connection, wallet, signMessage, rawIdl, kind, onStep } = params;
  const ephemHttp = rollupHttpForGuards();
  assertEphemeralRollupMatchesCluster(ephemHttp);

  const program = createDeskProgram(connection, wallet);
  const { collateralMint, borrowMint, programId, deskPda, deskLedgerPda } =
    deskContext();
  const deskCfg = await deskConfigClient(program).fetch(deskPda);
  const validatorPk = await resolveDelegateValidatorPk(ephemHttp);

  const baseIxs: TransactionInstruction[] = [];

  if (kind === "borrower") {
    const borrowerPda = deriveBorrowerPositionPda(
      programId,
      deskPda,
      wallet.publicKey,
    );
    const permBorrower = permissionPdaFromAccount(borrowerPda);
    const needsOpen =
      (await connection.getAccountInfo(borrowerPda, "confirmed")) === null;

    if (needsOpen) {
      baseIxs.push(
        await program.methods
          .openBorrower()
          .accounts({
            owner: wallet.publicKey,
            desk: deskPda,
            borrowerPosition: borrowerPda,
            permissionBorrower: permBorrower,
            permissionProgram: PERMISSION_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      );
    }

    const delPermBorrower = createDelegatePermissionInstruction({
      payer: wallet.publicKey,
      validator: validatorPk,
      permissionedAccount: [borrowerPda, false],
      authority: [wallet.publicKey, true],
    });
    const delBorrower = await program.methods
      .delegateBorrower()
      .accountsPartial({
        payer: wallet.publicKey,
        desk: deskPda,
        validator: validatorPk,
        pda: borrowerPda,
      })
      .instruction();
    baseIxs.push(delPermBorrower, delBorrower);
  } else {
    const lenderPda = deriveLenderPositionPda(
      programId,
      deskPda,
      wallet.publicKey,
    );
    const permLender = permissionPdaFromAccount(lenderPda);
    const needsOpen =
      (await connection.getAccountInfo(lenderPda, "confirmed")) === null;

    if (needsOpen) {
      baseIxs.push(
        await program.methods
          .openLender()
          .accounts({
            owner: wallet.publicKey,
            desk: deskPda,
            lenderPosition: lenderPda,
            permissionLender: permLender,
            permissionProgram: PERMISSION_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .instruction(),
      );
    }

    const delPermLender = createDelegatePermissionInstruction({
      payer: wallet.publicKey,
      validator: validatorPk,
      permissionedAccount: [lenderPda, false],
      authority: [wallet.publicKey, true],
    });
    const delLender = await program.methods
      .delegateLender()
      .accountsPartial({
        payer: wallet.publicKey,
        desk: deskPda,
        validator: validatorPk,
        pda: lenderPda,
      })
      .instruction();
    baseIxs.push(delPermLender, delLender);
  }

  if (deskCfg.authority.equals(wallet.publicKey)) {
    const delegated = await isDeskLedgerDelegated(connection, deskLedgerPda);
    if (!delegated) {
      const permDeskLedger = permissionPdaFromAccount(deskLedgerPda);
      baseIxs.push(
        createDelegatePermissionInstruction({
          payer: wallet.publicKey,
          validator: validatorPk,
          permissionedAccount: [deskLedgerPda, false],
          authority: [wallet.publicKey, true],
        }),
        await program.methods
          .delegateDeskLedger()
          .accountsPartial({
            payer: wallet.publicKey,
            desk: deskPda,
            pda: deskLedgerPda,
            validator: validatorPk,
          })
          .instruction(),
      );
    }
  }

  onStep?.("Sign base-layer transaction…");
  await sendChunkedBaseTransactions(
    connection,
    wallet,
    baseIxs,
    `activate_${kind}`,
  );

  const pdaForWait =
    kind === "borrower"
      ? deriveBorrowerPositionPda(programId, deskPda, wallet.publicKey)
      : deriveLenderPositionPda(programId, deskPda, wallet.publicKey);
  const er = await getErConnection(wallet, signMessage);
  await waitRollupPermissionOrThrow(
    er.rpcEndpoint,
    permissionPdaFromAccount(pdaForWait),
    ephemHttp,
  );
  onStep?.(null);
}

async function sendSinglePerIx(params: {
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  label: string;
  build: (program: Program) => Promise<TransactionInstruction>;
}): Promise<void> {
  const { wallet, signMessage, rawIdl, label, build } = params;
  const er = await getErConnection(wallet, signMessage);
  const program = createErDeskProgram(er, wallet, rawIdl);
  const ix = await build(program);
  const tx = new Transaction().add(ix);
  await sendSignedEphemeralTx(er, wallet, tx, label);
}

export async function depositCollateral(params: {
  connection: Connection;
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  amount: BN;
}): Promise<void> {
  const { connection, wallet, signMessage, rawIdl, amount } = params;
  const { programId, deskPda } = deskContext();
  const baseProgram = createDeskProgram(connection, wallet);
  const deskCfg = await deskConfigClient(baseProgram).fetch(deskPda);
  await ensureWalletSplForPerOperations({
    connection,
    wallet,
    steps: [
      { mint: deskCfg.collateralMint, amount: BigInt(amount.toString()) },
    ],
  });
  await assertRollupSplAtaAtLeast({
    wallet,
    signMessage,
    mint: deskCfg.collateralMint,
    minRaw: BigInt(amount.toString()),
    action: "Deposit collateral",
  });
  const borrowerPda = deriveBorrowerPositionPda(
    programId,
    deskPda,
    wallet.publicKey,
  );
  await sendSinglePerIx({
    wallet,
    signMessage,
    rawIdl,
    label: "deposit_collateral",
    build: async (program) => {
      const desk = await deskConfigClient(program).fetch(deskPda);
      const userCol = getAssociatedTokenAddressSync(
        desk.collateralMint,
        wallet.publicKey,
      );
      return program.methods
        .depositCollateral(amount)
        .accounts({
          owner: wallet.publicKey,
          desk: deskPda,
          borrowerPosition: borrowerPda,
          collateralVault: desk.collateralVault,
          userCollateralAta: userCol,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    },
  });
}

export async function borrow(params: {
  connection: Connection;
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  amount: BN;
}): Promise<void> {
  const { connection, wallet, signMessage, rawIdl, amount } = params;
  const { programId, deskPda, deskLedgerPda } = deskContext();
  const baseProgram = createDeskProgram(connection, wallet);
  const deskCfg = await deskConfigClient(baseProgram).fetch(deskPda);
  await ensureWalletSplForPerOperations({
    connection,
    wallet,
    steps: [{ mint: deskCfg.borrowMint, amount: BigInt(amount.toString()) }],
  });
  const borrowerPda = deriveBorrowerPositionPda(
    programId,
    deskPda,
    wallet.publicKey,
  );
  await sendSinglePerIx({
    wallet,
    signMessage,
    rawIdl,
    label: "borrow",
    build: async (program) => {
      const desk = await deskConfigClient(program).fetch(deskPda);
      const userBor = getAssociatedTokenAddressSync(
        desk.borrowMint,
        wallet.publicKey,
      );
      return program.methods
        .borrow(amount)
        .accounts({
          owner: wallet.publicKey,
          desk: deskPda,
          deskLedger: deskLedgerPda,
          borrowerPosition: borrowerPda,
          borrowVault: desk.borrowVault,
          userBorrowAta: userBor,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    },
  });
}

export async function repay(params: {
  connection: Connection;
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  amount: BN;
}): Promise<void> {
  const { connection, wallet, signMessage, rawIdl, amount } = params;
  const { programId, deskPda, deskLedgerPda } = deskContext();
  const baseProgram = createDeskProgram(connection, wallet);
  const deskCfg = await deskConfigClient(baseProgram).fetch(deskPda);
  await ensureWalletSplForPerOperations({
    connection,
    wallet,
    steps: [{ mint: deskCfg.borrowMint, amount: BigInt(amount.toString()) }],
  });
  await assertRollupSplAtaAtLeast({
    wallet,
    signMessage,
    mint: deskCfg.borrowMint,
    minRaw: BigInt(amount.toString()),
    action: "Repay",
  });
  const borrowerPda = deriveBorrowerPositionPda(
    programId,
    deskPda,
    wallet.publicKey,
  );
  await sendSinglePerIx({
    wallet,
    signMessage,
    rawIdl,
    label: "repay",
    build: async (program) => {
      const desk = await deskConfigClient(program).fetch(deskPda);
      const userBor = getAssociatedTokenAddressSync(
        desk.borrowMint,
        wallet.publicKey,
      );
      return program.methods
        .repay(amount)
        .accounts({
          owner: wallet.publicKey,
          desk: deskPda,
          deskLedger: deskLedgerPda,
          borrowerPosition: borrowerPda,
          borrowVault: desk.borrowVault,
          userBorrowAta: userBor,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    },
  });
}

export async function withdrawCollateral(params: {
  connection: Connection;
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  amount: BN;
}): Promise<void> {
  const { connection, wallet, signMessage, rawIdl, amount } = params;
  const { programId, deskPda } = deskContext();
  const baseProgram = createDeskProgram(connection, wallet);
  const deskCfg = await deskConfigClient(baseProgram).fetch(deskPda);
  await ensureWalletSplForPerOperations({
    connection,
    wallet,
    steps: [
      { mint: deskCfg.collateralMint, amount: BigInt(amount.toString()) },
    ],
  });
  const borrowerPda = deriveBorrowerPositionPda(
    programId,
    deskPda,
    wallet.publicKey,
  );
  await sendSinglePerIx({
    wallet,
    signMessage,
    rawIdl,
    label: "withdraw_collateral",
    build: async (program) => {
      const desk = await deskConfigClient(program).fetch(deskPda);
      const userCol = getAssociatedTokenAddressSync(
        desk.collateralMint,
        wallet.publicKey,
      );
      return program.methods
        .withdrawCollateral(amount)
        .accounts({
          owner: wallet.publicKey,
          desk: deskPda,
          borrowerPosition: borrowerPda,
          collateralVault: desk.collateralVault,
          userCollateralAta: userCol,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    },
  });
}

export async function depositLiquidity(params: {
  connection: Connection;
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  amount: BN;
  lpToMint: BN;
}): Promise<void> {
  const { connection, wallet, signMessage, rawIdl, amount, lpToMint } = params;
  const { programId, deskPda, deskLedgerPda } = deskContext();
  const baseProgram = createDeskProgram(connection, wallet);
  const deskCfg = await deskConfigClient(baseProgram).fetch(deskPda);
  await ensureWalletSplForPerOperations({
    connection,
    wallet,
    steps: [
      { mint: deskCfg.borrowMint, amount: BigInt(amount.toString()) },
      { mint: deskCfg.lpMint, amount: BigInt(0), idempotent: true },
    ],
  });
  await assertRollupSplAtaAtLeast({
    wallet,
    signMessage,
    mint: deskCfg.borrowMint,
    minRaw: BigInt(amount.toString()),
    action: "Deposit liquidity",
  });
  const lenderPda = deriveLenderPositionPda(
    programId,
    deskPda,
    wallet.publicKey,
  );
  await sendSinglePerIx({
    wallet,
    signMessage,
    rawIdl,
    label: "deposit_liquidity",
    build: async (program) => {
      const desk = await deskConfigClient(program).fetch(deskPda);
      const lenderBor = getAssociatedTokenAddressSync(
        desk.borrowMint,
        wallet.publicKey,
      );
      const lenderLp = getAssociatedTokenAddressSync(
        desk.lpMint,
        wallet.publicKey,
      );
      return program.methods
        .depositLiquidity(amount, lpToMint)
        .accounts({
          lender: wallet.publicKey,
          desk: deskPda,
          deskLedger: deskLedgerPda,
          lenderPosition: lenderPda,
          borrowVault: desk.borrowVault,
          lpMint: desk.lpMint,
          lenderBorrowAta: lenderBor,
          lenderLpAta: lenderLp,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    },
  });
}

export async function withdrawLp(params: {
  connection: Connection;
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  shares: BN;
}): Promise<void> {
  const { connection, wallet, signMessage, rawIdl, shares } = params;
  const { programId, deskPda, deskLedgerPda } = deskContext();
  const baseProgram = createDeskProgram(connection, wallet);
  const deskCfg = await deskConfigClient(baseProgram).fetch(deskPda);
  await ensureWalletSplForPerOperations({
    connection,
    wallet,
    steps: [
      { mint: deskCfg.lpMint, amount: BigInt(shares.toString()) },
      { mint: deskCfg.borrowMint, amount: BigInt(0), idempotent: true },
    ],
  });
  await assertRollupSplAtaAtLeast({
    wallet,
    signMessage,
    mint: deskCfg.lpMint,
    minRaw: BigInt(shares.toString()),
    action: "Withdraw LP",
  });
  const lenderPda = deriveLenderPositionPda(
    programId,
    deskPda,
    wallet.publicKey,
  );
  await sendSinglePerIx({
    wallet,
    signMessage,
    rawIdl,
    label: "withdraw_lp",
    build: async (program) => {
      const desk = await deskConfigClient(program).fetch(deskPda);
      const lenderBor = getAssociatedTokenAddressSync(
        desk.borrowMint,
        wallet.publicKey,
      );
      const lenderLp = getAssociatedTokenAddressSync(
        desk.lpMint,
        wallet.publicKey,
      );
      return program.methods
        .withdrawLp(shares)
        .accounts({
          lender: wallet.publicKey,
          desk: deskPda,
          deskLedger: deskLedgerPda,
          lenderPosition: lenderPda,
          borrowVault: desk.borrowVault,
          lpMint: desk.lpMint,
          lenderBorrowAta: lenderBor,
          lenderLpAta: lenderLp,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
    },
  });
}

export async function closePosition(params: {
  wallet: AnchorWallet;
  signMessage: (m: Uint8Array) => Promise<Uint8Array>;
  rawIdl: object;
  kind: "borrower" | "lender";
}): Promise<void> {
  const { wallet, signMessage, rawIdl, kind } = params;
  const { programId, deskPda } = deskContext();
  await sendSinglePerIx({
    wallet,
    signMessage,
    rawIdl,
    label:
      kind === "borrower"
        ? "close_borrower_position_per"
        : "close_lender_position_per",
    build: async (program) => {
      if (kind === "borrower") {
        const borrowerPda = deriveBorrowerPositionPda(
          programId,
          deskPda,
          wallet.publicKey,
        );
        return program.methods
          .closeBorrowerPositionPer()
          .accounts({
            owner: wallet.publicKey,
            borrowerPosition: borrowerPda,
            desk: deskPda,
            magicContext: MAGIC_CONTEXT_ID,
            magicProgram: MAGIC_PROGRAM_ID,
          })
          .instruction();
      }
      const lenderPda = deriveLenderPositionPda(
        programId,
        deskPda,
        wallet.publicKey,
      );
      return program.methods
        .closeLenderPositionPer()
        .accounts({
          owner: wallet.publicKey,
          lenderPosition: lenderPda,
          desk: deskPda,
          magicContext: MAGIC_CONTEXT_ID,
          magicProgram: MAGIC_PROGRAM_ID,
        })
        .instruction();
    },
  });
}

export { confirmErTransactionSucceeded } from "@/lib/desk-rollup";
