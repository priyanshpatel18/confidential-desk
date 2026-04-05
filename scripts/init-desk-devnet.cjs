/**
 * One-time (per mint pair): `initialize_desk` on the base layer.
 * Creates desk PDA, LP mint, desk ledger + permission — no vault ATAs yet
 * (those are created on the Ephemeral Rollup via `init_desk_vaults`).
 *
 *   cd confidential-desk
 *   yarn install
 *   anchor build && yarn sync-idl-desk
 *   yarn init-desk-devnet
 *
 * Env:
 *   ANCHOR_PROVIDER_URL  — default https://api.devnet.solana.com
 *   ANCHOR_WALLET        — default ~/.config/solana/id.json
 *   COLLATERAL_MINT      — optional base58 (default: WSOL)
 *   BORROW_MINT          — optional base58 (default: Circle devnet USDC)
 *
 * Next steps (same or any wallet with SOL on ER):
 *   yarn init-desk-vaults-er-devnet
 * As desk authority (so lenders can use PER ledger):
 *   yarn activate-desk-ledger-er-devnet
 */

const anchor = require("@coral-xyz/anchor");
const os = require("os");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const { permissionPdaFromAccount } = require("@magicblock-labs/ephemeral-rollups-sdk");
const BN = require("bn.js");
const fs = require("fs");
const path = require("path");

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
);

const DESK_SEED = Buffer.from("desk");
const LEDGER_SEED = Buffer.from("ledger");
const LP_MINT_SEED = Buffer.from("lp_mint");

const INTEREST_BPS = Number(process.env.INTEREST_BPS || 500);
const LTV_MAX_BPS = Number(process.env.LTV_MAX_BPS || 8000);
const LIQ_THRESHOLD_BPS = Number(process.env.LIQ_THRESHOLD_BPS || 8500);
const LIQ_BONUS_BPS = Number(process.env.LIQ_BONUS_BPS || 500);
const PRICE_Q12 = new BN(process.env.PRICE_Q12 || "1000000000000");

const idlPath = path.join(__dirname, "../app/lib/confidential_desk.json");
const idlFallback = path.join(__dirname, "../target/idl/confidential_desk.json");

function loadIdl() {
  if (fs.existsSync(idlPath)) {
    return JSON.parse(fs.readFileSync(idlPath, "utf8"));
  }
  if (fs.existsSync(idlFallback)) {
    console.warn("Using target/idl/confidential_desk.json (run: yarn sync-idl-desk)");
    return JSON.parse(fs.readFileSync(idlFallback, "utf8"));
  }
  throw new Error(
    "IDL not found. Run:\n  anchor build && yarn sync-idl-desk",
  );
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
    if (!fs.existsSync(defaultKeypair)) {
      throw new Error(
        "ANCHOR_WALLET is not set and ~/.config/solana/id.json was not found.\n" +
          "  export ANCHOR_WALLET=/path/to/your-keypair.json",
      );
    }
    process.env.ANCHOR_WALLET = defaultKeypair;
  }
  console.log("RPC:   ", process.env.ANCHOR_PROVIDER_URL);
  console.log("Wallet:", process.env.ANCHOR_WALLET);
}

function collateralMintPk() {
  const s = process.env.COLLATERAL_MINT?.trim();
  return s ? new PublicKey(s) : WSOL;
}

function borrowMintPk() {
  const s = process.env.BORROW_MINT?.trim();
  return s ? new PublicKey(s) : DEVNET_USDC;
}

async function main() {
  ensureAnchorEnv();
  const idl = loadIdl();
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);

  const programInfo = await provider.connection.getAccountInfo(
    program.programId,
    "confirmed",
  );
  if (!programInfo) {
    throw new Error(
      `Program ${program.programId.toBase58()} is not deployed on this cluster.\n` +
        "Deploy with: anchor deploy --provider.cluster devnet",
    );
  }

  const col = collateralMintPk();
  const bor = borrowMintPk();

  const [deskPda] = PublicKey.findProgramAddressSync(
    [DESK_SEED, col.toBuffer(), bor.toBuffer()],
    program.programId,
  );
  const [deskLedgerPda] = PublicKey.findProgramAddressSync(
    [LEDGER_SEED, deskPda.toBuffer()],
    program.programId,
  );
  const [lpMintPda] = PublicKey.findProgramAddressSync(
    [LP_MINT_SEED, col.toBuffer(), bor.toBuffer()],
    program.programId,
  );
  const permissionDeskLedger = permissionPdaFromAccount(deskLedgerPda);

  const existing = await provider.connection.getAccountInfo(deskPda, "confirmed");
  if (existing) {
    console.log("Desk already initialized:", deskPda.toBase58());
    console.log("  Collateral mint:", col.toBase58());
    console.log("  Borrow mint:    ", bor.toBase58());
    console.log("  Program:        ", program.programId.toBase58());
    console.log("\nNext: yarn init-desk-vaults-er-devnet  (then authority: yarn activate-desk-ledger-er-devnet)");
    return;
  }

  console.log("Initializing desk…");
  console.log("  Desk PDA:        ", deskPda.toBase58());
  console.log("  Desk ledger:     ", deskLedgerPda.toBase58());
  console.log("  LP mint:         ", lpMintPda.toBase58());
  console.log("  Collateral mint: ", col.toBase58());
  console.log("  Borrow mint:     ", bor.toBase58());

  const sig = await program.methods
    .initializeDesk(
      INTEREST_BPS,
      LTV_MAX_BPS,
      LIQ_THRESHOLD_BPS,
      LIQ_BONUS_BPS,
      PRICE_Q12,
    )
    .accounts({
      authority: provider.wallet.publicKey,
      desk: deskPda,
      collateralMint: col,
      borrowMint: bor,
      lpMint: lpMintPda,
      deskLedger: deskLedgerPda,
      permissionDeskLedger,
      permissionProgram: PERMISSION_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  console.log("Done. Signature:", sig);
  console.log("\nNext steps:");
  console.log("  1. yarn init-desk-vaults-er-devnet   — create protocol vault ATAs on the rollup");
  console.log("  2. yarn activate-desk-ledger-er-devnet — desk authority delegates ledger (required for lending)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
