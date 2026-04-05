/**
 * One-time (per desk) base-layer Ephemeral SPL bootstrap for the desk PDA:
 *   - `bootstrap_desk_borrow_mint_espl` — pool `borrow_vault` writable on PER
 *   - `bootstrap_desk_lp_mint_espl` — `lp_mint` MintTo on PER
 *
 * Run as **desk authority** after `init-desk-vaults` and before lenders use `deposit_liquidity`.
 *
 *   cd confidential-desk
 *   yarn bootstrap-desk-espl-devnet
 *
 * Env: same as `activate-desk-ledger-er-devnet.cjs` (ANCHOR_PROVIDER_URL, ANCHOR_WALLET, EPHEMERAL_HTTP, …).
 */

const anchor = require("@coral-xyz/anchor");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
const {
  ConnectionMagicRouter,
  DELEGATION_PROGRAM_ID,
  EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
  deriveEphemeralAta,
  deriveVault,
} = require("@magicblock-labs/ephemeral-rollups-sdk");
const { sendAndConfirmLegacyTransaction } = require("./solana-tx-helpers.cjs");

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

const DEFAULT_EPHEMERAL_DEVNET_HTTP = "https://devnet.magicblock.app";
const DEFAULT_MAGIC_ROUTER_HTTP = "https://devnet-router.magicblock.app";
const DEFAULT_MAGIC_ROUTER_WS = "wss://devnet-router.magicblock.app";
const DEFAULT_TEE_VALIDATOR = new PublicKey(
  "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA",
);
const LOCAL_ER_VALIDATOR = new PublicKey(
  "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);

const DESK_SEED = Buffer.from("desk");

const idlPath = path.join(__dirname, "../app/lib/confidential_desk.json");
const idlFallback = path.join(__dirname, "../target/idl/confidential_desk.json");

function loadIdl() {
  if (fs.existsSync(idlPath)) {
    return JSON.parse(fs.readFileSync(idlPath, "utf8"));
  }
  if (fs.existsSync(idlFallback)) {
    console.warn("Using target/idl (run: yarn sync-idl-desk)");
    return JSON.parse(fs.readFileSync(idlFallback, "utf8"));
  }
  throw new Error("IDL not found. Run: anchor build && yarn sync-idl-desk");
}

function ensureAnchorEnv() {
  if (!process.env.ANCHOR_PROVIDER_URL?.trim()) {
    process.env.ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com";
  }
  if (!process.env.ANCHOR_WALLET?.trim()) {
    const defaultKeypair = path.join(
      os.homedir(),
      ".config",
      "solana",
      "id.json",
    );
    process.env.ANCHOR_WALLET = defaultKeypair;
  }
}

function collateralMint() {
  const s = process.env.COLLATERAL_MINT?.trim();
  return s ? new PublicKey(s) : WSOL;
}

function borrowMint() {
  const s = process.env.BORROW_MINT?.trim();
  return s ? new PublicKey(s) : DEVNET_USDC;
}

async function resolveDelegateValidatorPk(ephemeralHttp) {
  const fromEnv = process.env.EPHEMERAL_VALIDATOR?.trim();
  if (fromEnv) return new PublicKey(fromEnv);
  const h = ephemeralHttp.toLowerCase();
  if (h.includes("localhost") || h.includes("127.0.0.1")) {
    return LOCAL_ER_VALIDATOR;
  }
  if (h.includes("tee.magicblock.app")) {
    return DEFAULT_TEE_VALIDATOR;
  }
  const http =
    process.env.MAGIC_ROUTER_HTTP?.trim() || DEFAULT_MAGIC_ROUTER_HTTP;
  const ws = process.env.MAGIC_ROUTER_WS?.trim() || DEFAULT_MAGIC_ROUTER_WS;
  const router = new ConnectionMagicRouter(http, { wsEndpoint: ws });
  const { identity } = await router.getClosestValidator();
  if (!identity) {
    throw new Error("Magic router returned no validator; set EPHEMERAL_VALIDATOR.");
  }
  return new PublicKey(identity);
}

function vaultEphemeralAtaPda(globalVaultPk, mintPk) {
  const [pda] = PublicKey.findProgramAddressSync(
    [globalVaultPk.toBuffer(), mintPk.toBuffer()],
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  );
  return pda;
}

function esplAccountsForMint(deskPda, mintPk, tokenProgramId) {
  const [eata] = deriveEphemeralAta(deskPda, mintPk);
  const [gv] = deriveVault(mintPk);
  const vaultEphemeralAta = vaultEphemeralAtaPda(gv, mintPk);
  const gvAta = getAssociatedTokenAddressSync(
    mintPk,
    gv,
    true,
    tokenProgramId,
  );
  const buf = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
    eata,
    EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
  );
  const rec = delegationRecordPdaFromDelegatedAccount(eata);
  const meta = delegationMetadataPdaFromDelegatedAccount(eata);
  return {
    eata,
    globalVault: gv,
    vaultEphemeralAta,
    globalVaultAta: gvAta,
    buf,
    rec,
    meta,
  };
}

async function splTokenProgramForMint(connection, mintPk) {
  const info = await connection.getAccountInfo(mintPk, "confirmed");
  if (!info) {
    throw new Error(`Mint account not found: ${mintPk.toBase58()}`);
  }
  return info.owner;
}

async function main() {
  ensureAnchorEnv();
  const idl = loadIdl();
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);

  const col = collateralMint();
  const bor = borrowMint();
  const ephemeralHttp =
    process.env.EPHEMERAL_HTTP?.trim() || DEFAULT_EPHEMERAL_DEVNET_HTTP;

  const [deskPda] = PublicKey.findProgramAddressSync(
    [DESK_SEED, col.toBuffer(), bor.toBuffer()],
    program.programId,
  );

  const desk = await program.account.deskConfig.fetch(deskPda);
  const walletPk = provider.wallet.publicKey;
  if (!desk.authority.equals(walletPk)) {
    throw new Error(
      `Wallet ${walletPk.toBase58()} is not desk authority ${desk.authority.toBase58()}`,
    );
  }

  const validatorPk = await resolveDelegateValidatorPk(ephemeralHttp);
  console.log("Validator:", validatorPk.toBase58());

  const programAccounts = {
    esplTokenProgram: EPHEMERAL_SPL_TOKEN_PROGRAM_ID,
    delegationProgram: DELEGATION_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  };

  const borTp = await splTokenProgramForMint(provider.connection, bor);
  const borAcc = esplAccountsForMint(deskPda, bor, borTp);
  console.log("bootstrap_desk_borrow_mint_espl…");
  const tx1 = await program.methods
    .bootstrapDeskBorrowMintEspl(validatorPk)
    .accounts({
      authority: walletPk,
      desk: deskPda,
      borrowMint: bor,
      borrowVault: desk.borrowVault,
      eata: borAcc.eata,
      globalVault: borAcc.globalVault,
      vaultEphemeralAta: borAcc.vaultEphemeralAta,
      globalVaultAta: borAcc.globalVaultAta,
      delegationBuffer: borAcc.buf,
      delegationRecord: borAcc.rec,
      delegationMetadata: borAcc.meta,
      tokenProgram: borTp,
      ...programAccounts,
    })
    .transaction();
  const sig1 = await sendAndConfirmLegacyTransaction(
    provider.connection,
    tx1,
    provider.wallet,
    { commitment: "confirmed" },
  );
  console.log("  signature:", sig1);

  const lpMint = desk.lpMint;
  const lpTp = await splTokenProgramForMint(provider.connection, lpMint);
  const deskLpAta = getAssociatedTokenAddressSync(
    lpMint,
    deskPda,
    true,
    lpTp,
  );
  const lpAcc = esplAccountsForMint(deskPda, lpMint, lpTp);
  console.log("bootstrap_desk_lp_mint_espl…");
  const tx2 = await program.methods
    .bootstrapDeskLpMintEspl(validatorPk)
    .accounts({
      authority: walletPk,
      desk: deskPda,
      lpMint,
      tokenProgram: lpTp,
      deskLpAta,
      eata: lpAcc.eata,
      globalVault: lpAcc.globalVault,
      vaultEphemeralAta: lpAcc.vaultEphemeralAta,
      globalVaultAta: lpAcc.globalVaultAta,
      delegationBuffer: lpAcc.buf,
      delegationRecord: lpAcc.rec,
      delegationMetadata: lpAcc.meta,
      ...programAccounts,
    })
    .transaction();
  const sig2 = await sendAndConfirmLegacyTransaction(
    provider.connection,
    tx2,
    provider.wallet,
    { commitment: "confirmed" },
  );
  console.log("  signature:", sig2);
  console.log("Desk ESPL bootstrap complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
