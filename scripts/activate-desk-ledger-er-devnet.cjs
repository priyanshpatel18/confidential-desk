/**
 * Delegates `desk_ledger` to the Ephemeral Rollup so `deposit_liquidity`, `borrow`,
 * `repay`, etc. can update `DeskLedger` on PER.
 *
 * Run as the **desk authority** (same keypair that called `initialize_desk`).
 *
 *   cd confidential-desk
 *   yarn activate-desk-ledger-er-devnet
 *
 * Env (optional, same defaults as init-desk-devnet):
 *   ANCHOR_PROVIDER_URL   — default https://api.devnet.solana.com
 *   ANCHOR_WALLET         — default ~/.config/solana/id.json
 *
 * Optional overrides:
 *   COLLATERAL_MINT, BORROW_MINT — must match the desk pair (default WSOL + devnet USDC)
 *   EPHEMERAL_RPC         — ER JSON-RPC (default devnet-as); `getIdentity` → delegate validator
 *   EPHEMERAL_HTTP        — tee/local branch only (default https://devnet.magicblock.app)
 *   EPHEMERAL_VALIDATOR   — base58; if set, skips ER identity + Magic router
 *   MAGIC_ROUTER_HTTP, MAGIC_ROUTER_WS — fallback when ER getIdentity fails
 */

const anchor = require("@coral-xyz/anchor");
const os = require("os");
const { Connection, PublicKey, Transaction } = require("@solana/web3.js");
const { sendAndConfirmLegacyTransaction } = require("./solana-tx-helpers.cjs");
const {
  ConnectionMagicRouter,
  createDelegatePermissionInstruction,
  DELEGATION_PROGRAM_ID,
} = require("@magicblock-labs/ephemeral-rollups-sdk");
const fs = require("fs");
const path = require("path");

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEVNET_USDC = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1",
);

const DEFAULT_EPHEMERAL_DEVNET_HTTP = "https://devnet.magicblock.app";
const DEFAULT_ER_HTTP = "https://devnet-as.magicblock.app";
const DEFAULT_MAGIC_ROUTER_HTTP = "https://devnet-router.magicblock.app";
const DEFAULT_MAGIC_ROUTER_WS = "wss://devnet-router.magicblock.app";
const DEFAULT_TEE_VALIDATOR = new PublicKey(
  "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA",
);
const LOCAL_ER_VALIDATOR = new PublicKey(
  "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev",
);

const DESK_SEED = Buffer.from("desk");
const LEDGER_SEED = Buffer.from("ledger");

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
    "IDL not found. Run: anchor build && yarn sync-idl-desk",
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
        "ANCHOR_WALLET is not set and ~/.config/solana/id.json was not found.",
      );
    }
    process.env.ANCHOR_WALLET = defaultKeypair;
  }
  console.log("RPC:   ", process.env.ANCHOR_PROVIDER_URL);
  console.log("Wallet:", process.env.ANCHOR_WALLET);
}

function collateralMint() {
  const s = process.env.COLLATERAL_MINT?.trim();
  return s ? new PublicKey(s) : WSOL;
}

function borrowMint() {
  const s = process.env.BORROW_MINT?.trim();
  return s ? new PublicKey(s) : DEVNET_USDC;
}

async function tryValidatorFromErRpc() {
  const erRpc =
    process.env.EPHEMERAL_RPC?.trim() ||
    process.env.NEXT_PUBLIC_PER_EPHEMERAL_RPC?.trim() ||
    DEFAULT_ER_HTTP;
  const http = erRpc.replace(/\/+$/, "");
  try {
    const conn = new Connection(http, { commitment: "processed" });
    const raw = await conn._rpcRequest("getIdentity", []);
    const identity = raw?.result?.identity;
    if (identity) {
      const pk = new PublicKey(identity);
      console.log("Validator (ER getIdentity):", pk.toBase58());
      return pk;
    }
  } catch (e) {
    console.warn(
      "ER getIdentity failed (set EPHEMERAL_VALIDATOR or check EPHEMERAL_RPC):",
      e?.message || e,
    );
  }
  return null;
}

async function resolveDelegateValidatorPk(ephemeralHttp) {
  const fromEnv = process.env.EPHEMERAL_VALIDATOR?.trim();
  if (fromEnv) {
    const pk = new PublicKey(fromEnv);
    console.log("Validator (EPHEMERAL_VALIDATOR):", pk.toBase58());
    return pk;
  }
  const h = ephemeralHttp.toLowerCase();
  if (h.includes("localhost") || h.includes("127.0.0.1")) {
    console.log("Validator (local ER):", LOCAL_ER_VALIDATOR.toBase58());
    return LOCAL_ER_VALIDATOR;
  }
  if (h.includes("tee.magicblock.app")) {
    console.log("Validator (TEE):", DEFAULT_TEE_VALIDATOR.toBase58());
    return DEFAULT_TEE_VALIDATOR;
  }

  const fromEr = await tryValidatorFromErRpc();
  if (fromEr) return fromEr;

  const http =
    process.env.MAGIC_ROUTER_HTTP?.trim() || DEFAULT_MAGIC_ROUTER_HTTP;
  const ws = process.env.MAGIC_ROUTER_WS?.trim() || DEFAULT_MAGIC_ROUTER_WS;
  console.log("Magic router:", http);
  const router = new ConnectionMagicRouter(http, { wsEndpoint: ws });
  const { identity } = await router.getClosestValidator();
  if (!identity) {
    throw new Error(
      "Magic router did not return a validator. Set EPHEMERAL_VALIDATOR.",
    );
  }
  const pk = new PublicKey(identity);
  console.log("Validator (router):", pk.toBase58());
  return pk;
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
  const [deskLedgerPda] = PublicKey.findProgramAddressSync(
    [LEDGER_SEED, deskPda.toBuffer()],
    program.programId,
  );

  const deskInfo = await provider.connection.getAccountInfo(deskPda, "confirmed");
  if (!deskInfo) {
    throw new Error(
      `No desk at ${deskPda.toBase58()}. Run: yarn init-desk-devnet`,
    );
  }

  const desk = await program.account.deskConfig.fetch(deskPda);
  const authority = desk.authority;
  const walletPk = provider.wallet.publicKey;
  if (!authority.equals(walletPk)) {
    throw new Error(
      `Connected wallet ${walletPk.toBase58()} is not the desk authority ${authority.toBase58()}.\n` +
        "Use ANCHOR_WALLET=/path/to/authority.json or switch Solana CLI keypair.",
    );
  }

  const ledgerInfo = await provider.connection.getAccountInfo(
    deskLedgerPda,
    "confirmed",
  );
  if (!ledgerInfo) {
    throw new Error(`desk_ledger missing at ${deskLedgerPda.toBase58()}`);
  }

  if (ledgerInfo.owner.equals(DELEGATION_PROGRAM_ID)) {
    console.log(
      "desk_ledger is already delegated (owner is delegation program). Nothing to do.",
    );
    console.log("  desk_ledger:", deskLedgerPda.toBase58());
    return;
  }

  console.log("Delegating desk_ledger to ER for validator resolution from:", ephemeralHttp);
  const validatorPk = await resolveDelegateValidatorPk(ephemeralHttp);

  // Match anchor-rock-paper-scissor: validator on `createDelegatePermissionInstruction` accounts,
  // no ownerProgram override; base-layer `sendAndConfirmTransaction` bundles permission + delegate.
  const delPermDeskLedger = createDelegatePermissionInstruction({
    payer: walletPk,
    validator: validatorPk,
    permissionedAccount: [deskLedgerPda, false],
    authority: [walletPk, true],
  });

  const delDeskLedger = await program.methods
    .delegateDeskLedger()
    .accountsPartial({
      payer: walletPk,
      desk: deskPda,
      pda: deskLedgerPda,
      validator: validatorPk,
    })
    .instruction();

  const tx = new Transaction().add(delPermDeskLedger, delDeskLedger);
  const sig = await sendAndConfirmLegacyTransaction(
    provider.connection,
    tx,
    provider.wallet,
    { commitment: "confirmed" },
  );

  console.log("Done. desk_ledger delegated (RPS-style bundle). Signature:", sig);
  console.log("Other wallets can now lend/borrow on this desk (after their own position setup).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
