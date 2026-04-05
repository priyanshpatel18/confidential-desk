/**
 * TEE / PER privacy integration: token-scoped ER reads (RPS-style).
 * Run with: EPHEMERAL_TEE_INTEGRATION=1 anchor test --skip-deploy
 * Requires deployed program ID matching cluster + tee.magicblock.app (or EPHEMERAL_PROVIDER_ENDPOINT).
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createDelegatePermissionInstruction,
  getAuthToken,
  permissionPdaFromAccount,
  waitUntilPermissionActive,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  TOKEN_PROGRAM_ID,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as nacl from "tweetnacl";
import BN from "bn.js";
import { assert } from "chai";
import type { ConfidentialDesk } from "../target/types/confidential_desk";
import {
  PERMISSION_PROGRAM_ID,
  deriveBorrower,
  ensureAta,
  fundLamportsFromPayer,
  idl,
  seedPoolWithLenderDeposit,
  setupDesk,
} from "./desk-test-utils";

const ER_VALIDATOR = new anchor.web3.PublicKey(
  "FnE6VJT5QNZdedZPnCoLsARgBwoE6DeJNjBs2H1gySXA",
);

const teeUrl = (process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://tee.magicblock.app").replace(
  /\/$/,
  "",
);
const teeWsUrl = process.env.EPHEMERAL_WS_ENDPOINT || "wss://tee.magicblock.app";

const runTee = process.env.EPHEMERAL_TEE_INTEGRATION === "1";

(runTee ? describe : describe.skip)(
  "Confidential Desk — TEE privacy (token-scoped reads)",
  () => {
    let ownerEr: anchor.AnchorProvider;
    let snooperEr: anchor.AnchorProvider;
    let authOwner: { token: string };
    let authSnoop: { token: string };

    it("auth tokens + ER providers", async function () {
      this.timeout(120_000);
      if (!teeUrl.toLowerCase().includes("tee")) {
        this.skip();
      }
      const ctx = await setupDesk();
      const payer = ctx.payer;
      const snooper = Keypair.generate();
      await fundLamportsFromPayer(ctx.connection, payer, snooper.publicKey, 2_000_000);

      authOwner = await getAuthToken(teeUrl, payer.publicKey, (msg: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(msg, payer.secretKey)),
      );
      authSnoop = await getAuthToken(teeUrl, snooper.publicKey, (msg: Uint8Array) =>
        Promise.resolve(nacl.sign.detached(msg, snooper.secretKey)),
      );

      ownerEr = new anchor.AnchorProvider(
        new anchor.web3.Connection(`${teeUrl}?token=${authOwner.token}`, {
          wsEndpoint: `${teeWsUrl}?token=${authOwner.token}`,
          commitment: "processed",
        }),
        anchor.Wallet.local(),
      );
      snooperEr = new anchor.AnchorProvider(
        new anchor.web3.Connection(`${teeUrl}?token=${authSnoop.token}`, {
          wsEndpoint: `${teeWsUrl}?token=${authSnoop.token}`,
          commitment: "processed",
        }),
        anchor.Wallet.local(),
      );

      const owner = payer.publicKey;
      const borrowerPda = deriveBorrower(ctx.program.programId, ctx.deskPda, owner);

      const lenderBorrowAta = await ensureAta(
        ctx.connection,
        payer,
        owner,
        ctx.borrowMint.publicKey,
      );
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.borrowMint.publicKey,
            lenderBorrowAta,
            payer.publicKey,
            20_000_000n,
          ),
        ),
        [payer],
      );
      await seedPoolWithLenderDeposit(ctx, owner, new BN(5_000_000));

      await ctx.program.methods
        .openBorrower()
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
          permissionBorrower: permissionPdaFromAccount(borrowerPda),
          permissionProgram: PERMISSION_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const delPermB = createDelegatePermissionInstruction({
        payer: owner,
        validator: ER_VALIDATOR,
        permissionedAccount: [borrowerPda, false],
        authority: [owner, true],
      });
      const delPermL = createDelegatePermissionInstruction({
        payer: owner,
        validator: ER_VALIDATOR,
        permissionedAccount: [ctx.deskLedgerPda, false],
        authority: [owner, true],
      });
      const delB = await ctx.program.methods
        .delegateBorrower()
        .accountsPartial({
          payer: owner,
          desk: ctx.deskPda,
          validator: ER_VALIDATOR,
          pda: borrowerPda,
        })
        .instruction();
      const delLedger = await ctx.program.methods
        .delegateDeskLedger()
        .accountsPartial({ payer: owner, desk: ctx.deskPda, validator: ER_VALIDATOR, pda: ctx.deskLedgerPda })
        .instruction();

      const baseTx = new Transaction().add(delPermB, delPermL, delB, delLedger);
      baseTx.feePayer = payer.publicKey;
      baseTx.recentBlockhash = (await ctx.connection.getLatestBlockhash()).blockhash;
      const signed = await payer.signTransaction(baseTx as anchor.web3.Transaction);
      const sig = await ctx.connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      await ctx.connection.confirmTransaction(sig, "confirmed");

      const ok = await waitUntilPermissionActive(
        ownerEr.connection.rpcEndpoint,
        borrowerPda,
        90_000,
      );
      assert.ok(ok, "borrower delegation visible on ER");

      const userColAta = await ensureAta(
        ctx.connection,
        payer,
        owner,
        ctx.collateralMint.publicKey,
      );
      const col = new BN(500_000);
      const borrow = new BN(100_000);
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.collateralMint.publicKey,
            userColAta,
            payer.publicKey,
            BigInt(col.toString()),
          ),
        ),
        [payer],
      );
      const programEr = new Program(
        idl as ConfidentialDesk,
        new anchor.AnchorProvider(ownerEr.connection, new anchor.Wallet(payer), {
          commitment: "processed",
          skipPreflight: true,
        }),
      ) as Program<ConfidentialDesk>;

      await ensureAta(ctx.connection, payer, owner, ctx.borrowMint.publicKey);
      const userBorAta = getAssociatedTokenAddressSync(ctx.borrowMint.publicKey, owner);
      const depIx = await programEr.methods
        .depositCollateral(col)
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
          collateralVault: ctx.collateralVault,
          userCollateralAta: userColAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
      const tx1 = new Transaction().add(depIx);
      tx1.feePayer = payer.publicKey;
      tx1.recentBlockhash = (await ownerEr.connection.getLatestBlockhash()).blockhash;
      const s1 = await payer.signTransaction(tx1 as anchor.web3.Transaction);
      const sig1 = await ownerEr.connection.sendRawTransaction(s1.serialize(), {
        skipPreflight: true,
      });
      await ownerEr.connection.confirmTransaction(sig1, "processed");

      const borIx = await programEr.methods
        .borrow(borrow)
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          deskLedger: ctx.deskLedgerPda,
          borrowerPosition: borrowerPda,
          borrowVault: ctx.borrowVault,
          userBorrowAta: userBorAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();
      const tx2 = new Transaction().add(borIx);
      tx2.feePayer = payer.publicKey;
      tx2.recentBlockhash = (await ownerEr.connection.getLatestBlockhash()).blockhash;
      const s2 = await payer.signTransaction(tx2 as anchor.web3.Transaction);
      const sig2 = await ownerEr.connection.sendRawTransaction(s2.serialize(), {
        skipPreflight: true,
      });
      await ownerEr.connection.confirmTransaction(sig2, "processed");

      const ownInfo = await ownerEr.connection.getAccountInfo(borrowerPda);
      assert.ok(ownInfo !== null, "owner token can read borrower PDA on ER");
      const pos = programEr.coder.accounts.decode(
        "borrowerPosition",
        ownInfo!.data,
      ) as { collateralAmount: BN; debtAmount: BN };
      assert.equal(pos.collateralAmount.toString(), col.toString());
      assert.equal(pos.debtAmount.toString(), borrow.toString());

      const sneakBorrower = await snooperEr.connection.getAccountInfo(borrowerPda);
      assert.strictEqual(
        sneakBorrower,
        null,
        "other identity token must not read borrower position on ER",
      );
      const sneakLedger = await snooperEr.connection.getAccountInfo(ctx.deskLedgerPda);
      assert.strictEqual(
        sneakLedger,
        null,
        "other identity token must not read desk ledger on ER",
      );
    });
  },
);
