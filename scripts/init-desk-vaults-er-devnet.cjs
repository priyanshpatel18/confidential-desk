/**
 * Creates desk collateral + borrow vault ATAs (`init_desk_vaults`) on **Solana base** — same as
 * `tests/desk-test-utils.ts` and the same layer Anchor RPS uses for `createDelegatePermission` +
 * `delegatePda` (see `magicblock-engine-examples/anchor-rock-paper-scissor/tests`).
 * ER is for execution after accounts exist on base; mints + desk are not writable the same way on ER.
 *
 *   cd confidential-desk
 *   yarn init-desk-vaults-er-devnet
 *
 * Env:
 *   ANCHOR_PROVIDER_URL     — base RPC (default https://api.devnet.solana.com)
 *   ANCHOR_WALLET           — signer / payer (default ~/.config/solana/id.json)
 *   COLLATERAL_MINT, BORROW_MINT — must match `initialize_desk` pair (default WSOL + devnet USDC)
 */

const anchor = require("@coral-xyz/anchor");
const os = require("os");
const {
  Keypair,
  PublicKey,
  SystemProgram,
  Connection,
} = require("@solana/web3.js");
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} = require("@solana/spl-token");
const fs = require("fs");
const path = require("path");
const { sendAndConfirmLegacyTransaction } = require("./solana-tx-helpers.cjs");

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

const DESK_SEED = Buffer.from("desk");

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
  throw new Error("IDL not found. Run: anchor build && yarn sync-idl-desk");
}

function loadKeypair() {
  const p =
    process.env.ANCHOR_WALLET?.trim() ||
    path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(p)) {
    throw new Error(`Keypair not found: ${p} (set ANCHOR_WALLET)`);
  }
  const secret = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
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
  const idl = loadIdl();
  const payer = loadKeypair();
  const wallet = new anchor.Wallet(payer);

  const baseRpc =
    process.env.ANCHOR_PROVIDER_URL?.trim() ||
    "https://api.devnet.solana.com";
  const baseConn = new Connection(baseRpc, "confirmed");
  const baseProvider = new anchor.AnchorProvider(baseConn, wallet, {
    commitment: "confirmed",
    skipPreflight: true,
  });
  const baseProgram = new anchor.Program(idl, baseProvider);

  const col = collateralMintPk();
  const bor = borrowMintPk();

  const [deskPda] = PublicKey.findProgramAddressSync(
    [DESK_SEED, col.toBuffer(), bor.toBuffer()],
    baseProgram.programId,
  );

  const deskOnBase = await baseConn.getAccountInfo(deskPda, "confirmed");
  if (!deskOnBase) {
    throw new Error(
      `No desk on base RPC at ${deskPda.toBase58()}.\n` +
        "Run first: yarn init-desk-devnet",
    );
  }

  const desk = await baseProgram.account.deskConfig.fetch(deskPda);

  console.log("Base RPC:", baseRpc);
  const collateralVault = desk.collateralVault;
  const borrowVault = desk.borrowVault;

  console.log("Desk:            ", deskPda.toBase58());
  console.log("Collateral vault:", collateralVault.toBase58());
  console.log("Borrow vault:    ", borrowVault.toBase58());

  const tx = await baseProgram.methods
    .initDeskVaults()
    .accounts({
      payer: payer.publicKey,
      desk: deskPda,
      collateralMint: col,
      borrowMint: bor,
      collateralVault,
      borrowVault,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const sig = await sendAndConfirmLegacyTransaction(baseConn, tx, wallet, {
    commitment: "confirmed",
  });

  console.log("init_desk_vaults OK. Signature:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
