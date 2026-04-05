/**
 * Desk authority: update SOL/USD (collateral) price used for LTV checks (`update_oracle`).
 *
 *   cd confidential-desk
 *   yarn update-oracle-devnet
 *
 * Env:
 *   ANCHOR_PROVIDER_URL, ANCHOR_WALLET — same as other scripts
 *   COLLATERAL_MINT, BORROW_MINT       — desk mint pair (defaults WSOL + devnet USDC)
 *   PRICE_Q12                          — price in Q64.12 fixed point (default 1e12 = $1 if 1:1 scaled)
 */

const anchor = require("@coral-xyz/anchor");
const os = require("os");
const { PublicKey } = require("@solana/web3.js");
const BN = require("bn.js");
const fs = require("fs");
const path = require("path");

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
    return JSON.parse(fs.readFileSync(idlFallback, "utf8"));
  }
  throw new Error("IDL not found. Run: anchor build && yarn sync-idl-desk");
}

function ensureAnchorEnv() {
  if (!process.env.ANCHOR_PROVIDER_URL?.trim()) {
    process.env.ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com";
  }
  if (!process.env.ANCHOR_WALLET?.trim()) {
    const p = path.join(os.homedir(), ".config", "solana", "id.json");
    if (!fs.existsSync(p)) {
      throw new Error("Set ANCHOR_WALLET");
    }
    process.env.ANCHOR_WALLET = p;
  }
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

  const col = collateralMintPk();
  const bor = borrowMintPk();
  const [deskPda] = PublicKey.findProgramAddressSync(
    [DESK_SEED, col.toBuffer(), bor.toBuffer()],
    program.programId,
  );

  const desk = await program.account.deskConfig.fetch(deskPda);
  const auth = desk.authority;
  if (!auth.equals(provider.wallet.publicKey)) {
    throw new Error(
      `Wallet ${provider.wallet.publicKey.toBase58()} is not desk authority ${auth.toBase58()}`,
    );
  }

  const price = new BN(process.env.PRICE_Q12 || "1000000000000");
  console.log("Desk:", deskPda.toBase58());
  console.log("New collateral_price_q12:", price.toString(10));

  const sig = await program.methods
    .updateOracle(price)
    .accountsPartial({
      authority: provider.wallet.publicKey,
      desk: deskPda,
    })
    .rpc({ skipPreflight: true, commitment: "confirmed" });

  console.log("Done. Signature:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
