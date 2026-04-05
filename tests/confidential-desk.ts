import * as anchor from "@coral-xyz/anchor";
import { permissionPdaFromAccount } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  TOKEN_PROGRAM_ID,
  createMintToInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { assert } from "chai";
import {
  INTEREST_BPS,
  LIQ_THRESHOLD_BPS,
  LTV_MAX_BPS,
  PERMISSION_PROGRAM_ID,
  PRICE_Q12,
  type DeskCtx,
  deriveBorrower,
  deriveLender,
  ensureAta,
  fundLamportsFromPayer,
  seedPoolWithLenderDeposit,
  setupDesk,
} from "./desk-test-utils";

function assertInsufficientRollupSplAta(e: unknown): void {
  if (e instanceof anchor.AnchorError) {
    assert.equal(
      e.error.errorCode.code,
      "InsufficientRollupSplAta",
      e.error?.errorMessage ?? String(e),
    );
    return;
  }
  const logs =
    e !== null &&
    typeof e === "object" &&
    "logs" in e &&
    Array.isArray((e as { logs: unknown }).logs)
      ? (e as { logs: string[] }).logs
      : null;
  if (logs) {
    const parsed = anchor.AnchorError.parse(logs);
    if (parsed) {
      assert.equal(
        parsed.error.errorCode.code,
        "InsufficientRollupSplAta",
        parsed.message,
      );
      return;
    }
  }
  assert.fail(`expected AnchorError InsufficientRollupSplAta, got ${String(e)}`);
}

describe("Confidential Lending Desk", () => {
  describe("desk config", () => {
    let ctx: DeskCtx;

    before(async () => {
      ctx = await setupDesk();
    });

    it("initializes desk + vaults with expected risk parameters", async () => {
      const desk = await ctx.program.account.deskConfig.fetch(ctx.deskPda);
      assert.equal(desk.authority.toBase58(), ctx.payer.publicKey.toBase58());
      assert.equal(desk.ltvMaxBps, LTV_MAX_BPS);
      assert.equal(desk.liquidationThresholdBps, LIQ_THRESHOLD_BPS);
      assert.equal(desk.interestRateBps, INTEREST_BPS);
      assert.ok(desk.collateralPriceQ12.eq(PRICE_Q12));
      assert.ok(desk.collateralVault.equals(ctx.collateralVault));
      assert.ok(desk.borrowVault.equals(ctx.borrowVault));
      const ledger = await ctx.program.account.deskLedger.fetch(ctx.deskLedgerPda);
      assert.equal(ledger.totalDeposits.toNumber(), 0);
      assert.equal(ledger.totalBorrowed.toNumber(), 0);
      assert.equal(ledger.lpTotalMinted.toNumber(), 0);
    });

    it("update_oracle changes collateral_price_q12", async () => {
      const newPrice = new BN(2_000_000_000_000);
      await ctx.program.methods
        .updateOracle(newPrice)
        .accountsPartial({
          authority: ctx.payer.publicKey,
          desk: ctx.deskPda,
        })
        .rpc();
      const desk = await ctx.program.account.deskConfig.fetch(ctx.deskPda);
      assert.ok(desk.collateralPriceQ12.eq(newPrice));
    });

    it("rejects update_oracle from non-authority", async () => {
      const rogue = Keypair.generate();
      await fundLamportsFromPayer(
        ctx.connection,
        ctx.payer,
        rogue.publicKey,
        1_000_000,
      );
      let threw = false;
      try {
        await ctx.program.methods
          .updateOracle(PRICE_Q12)
          .accountsPartial({
            authority: rogue.publicKey,
            desk: ctx.deskPda,
          })
          .signers([rogue])
          .rpc();
      } catch {
        threw = true;
      }
      assert.ok(threw);
    });
  });

  describe("lender: deposit_liquidity", () => {
    let ctx: DeskCtx;

    before(async () => {
      ctx = await setupDesk();
      const lenderBorrowAta = await ensureAta(
        ctx.connection,
        ctx.payer,
        ctx.payer.publicKey,
        ctx.borrowMint.publicKey,
      );
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.borrowMint.publicKey,
            lenderBorrowAta,
            ctx.payer.publicKey,
            5_000_000n,
          ),
        ),
        [ctx.payer],
      );
    });

    it("mints LP and updates desk_ledger", async () => {
      const amount = new BN(1_000_000);
      await seedPoolWithLenderDeposit(ctx, ctx.payer.publicKey, amount);

      const ledger = await ctx.program.account.deskLedger.fetch(ctx.deskLedgerPda);
      assert.equal(ledger.totalDeposits.toString(), amount.toString());
      assert.equal(ledger.lpTotalMinted.toString(), amount.toString());
      const lpInfo = await getMint(ctx.connection, ctx.lpMintPda);
      assert.equal(lpInfo.supply.toString(), amount.toString());
    });
  });

  describe("borrower: deposit_collateral, borrow, repay", () => {
    let ctx: DeskCtx;
    const collateralAtoms = new BN(2_000_000);
    const borrowAtoms = new BN(500_000);

    before(async () => {
      ctx = await setupDesk();
      const lenderBorrowAta = await ensureAta(
        ctx.connection,
        ctx.payer,
        ctx.payer.publicKey,
        ctx.borrowMint.publicKey,
      );
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.borrowMint.publicKey,
            lenderBorrowAta,
            ctx.payer.publicKey,
            10_000_000n,
          ),
        ),
        [ctx.payer],
      );
      await seedPoolWithLenderDeposit(ctx, ctx.payer.publicKey, new BN(5_000_000));

      const owner = ctx.payer.publicKey;
      const borrowerPda = deriveBorrower(ctx.program.programId, ctx.deskPda, owner);
      await ctx.program.methods
        .openBorrower()
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
          permissionBorrower: permissionPdaFromAccount(borrowerPda),
          permissionProgram: PERMISSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const userCol = await ensureAta(
        ctx.connection,
        ctx.payer,
        owner,
        ctx.collateralMint.publicKey,
      );
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.collateralMint.publicKey,
            userCol,
            ctx.payer.publicKey,
            BigInt(collateralAtoms.toString()),
          ),
        ),
        [ctx.payer],
      );

      await ctx.program.methods
        .depositCollateral(collateralAtoms)
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
          collateralVault: ctx.collateralVault,
          userCollateralAta: userCol,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
    });

    it("borrow pulls USDC from vault and updates debt", async () => {
      const owner = ctx.payer.publicKey;
      const borrowerPda = deriveBorrower(ctx.program.programId, ctx.deskPda, owner);
      const userBor = getAssociatedTokenAddressSync(
        ctx.borrowMint.publicKey,
        owner,
      );

      await ctx.program.methods
        .borrow(borrowAtoms)
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          deskLedger: ctx.deskLedgerPda,
          borrowerPosition: borrowerPda,
          borrowVault: ctx.borrowVault,
          userBorrowAta: userBor,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const pos = await ctx.program.account.borrowerPosition.fetch(borrowerPda);
      assert.ok(pos.debtAmount.eq(borrowAtoms));
      const ledger = await ctx.program.account.deskLedger.fetch(ctx.deskLedgerPda);
      assert.ok(ledger.totalBorrowed.eq(borrowAtoms));
    });

    it("repay reduces debt", async () => {
      const owner = ctx.payer.publicKey;
      const borrowerPda = deriveBorrower(ctx.program.programId, ctx.deskPda, owner);
      const userBor = getAssociatedTokenAddressSync(
        ctx.borrowMint.publicKey,
        owner,
      );
      const half = borrowAtoms.divn(2);
      await ctx.program.methods
        .repay(half)
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          deskLedger: ctx.deskLedgerPda,
          borrowerPosition: borrowerPda,
          borrowVault: ctx.borrowVault,
          userBorrowAta: userBor,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      const pos = await ctx.program.account.borrowerPosition.fetch(borrowerPda);
      assert.ok(pos.debtAmount.eq(borrowAtoms.sub(half)));
    });
  });

  describe("withdraw_lp", () => {
    let ctx: DeskCtx;

    before(async () => {
      ctx = await setupDesk();
      const lenderBorrowAta = await ensureAta(
        ctx.connection,
        ctx.payer,
        ctx.payer.publicKey,
        ctx.borrowMint.publicKey,
      );
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.borrowMint.publicKey,
            lenderBorrowAta,
            ctx.payer.publicKey,
            5_000_000n,
          ),
        ),
        [ctx.payer],
      );
      await seedPoolWithLenderDeposit(ctx, ctx.payer.publicKey, new BN(2_000_000));
    });

    it("burns LP and returns USDC proportionally", async () => {
      const owner = ctx.payer.publicKey;
      const lenderPda = deriveLender(ctx.program.programId, ctx.deskPda, owner);
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
      const withdrawShares = new BN(500_000);
      await ctx.program.methods
        .withdrawLp(withdrawShares)
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
      const ledger = await ctx.program.account.deskLedger.fetch(ctx.deskLedgerPda);
      assert.equal(ledger.lpTotalMinted.toString(), "1500000");
    });
  });

  describe("insufficient rollup SPL ATA (on-chain guard)", () => {
    it("deposit_liquidity: InsufficientRollupSplAta when borrow ATA is empty", async () => {
      const ctx = await setupDesk();
      const owner = ctx.payer.publicKey;
      const lenderPda = deriveLender(ctx.program.programId, ctx.deskPda, owner);
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

      try {
        await ctx.program.methods
          .depositLiquidity(new BN(1_000), new BN(1_000))
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
        assert.fail("expected deposit_liquidity to fail");
      } catch (e) {
        assertInsufficientRollupSplAta(e);
      }
    });

    it("deposit_collateral: InsufficientRollupSplAta when collateral ATA is empty", async () => {
      const ctx = await setupDesk();
      const owner = ctx.payer.publicKey;
      const borrowerPda = deriveBorrower(ctx.program.programId, ctx.deskPda, owner);
      await ctx.program.methods
        .openBorrower()
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
          permissionBorrower: permissionPdaFromAccount(borrowerPda),
          permissionProgram: PERMISSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const userCol = await ensureAta(
        ctx.connection,
        ctx.payer,
        owner,
        ctx.collateralMint.publicKey,
      );

      try {
        await ctx.program.methods
          .depositCollateral(new BN(1))
          .accountsPartial({
            owner,
            desk: ctx.deskPda,
            borrowerPosition: borrowerPda,
            collateralVault: ctx.collateralVault,
            userCollateralAta: userCol,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected deposit_collateral to fail");
      } catch (e) {
        assertInsufficientRollupSplAta(e);
      }
    });

    it("repay: InsufficientRollupSplAta when borrow ATA cannot cover payment", async () => {
      const ctx = await setupDesk();
      const owner = ctx.payer.publicKey;
      const lenderBorrowAta = await ensureAta(
        ctx.connection,
        ctx.payer,
        owner,
        ctx.borrowMint.publicKey,
      );
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.borrowMint.publicKey,
            lenderBorrowAta,
            ctx.payer.publicKey,
            10_000_000n,
          ),
        ),
        [ctx.payer],
      );
      await seedPoolWithLenderDeposit(ctx, owner, new BN(5_000_000));

      const borrowerPda = deriveBorrower(ctx.program.programId, ctx.deskPda, owner);
      await ctx.program.methods
        .openBorrower()
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
          permissionBorrower: permissionPdaFromAccount(borrowerPda),
          permissionProgram: PERMISSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const userCol = await ensureAta(
        ctx.connection,
        ctx.payer,
        owner,
        ctx.collateralMint.publicKey,
      );
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.collateralMint.publicKey,
            userCol,
            ctx.payer.publicKey,
            2_000_000n,
          ),
        ),
        [ctx.payer],
      );
      await ctx.program.methods
        .depositCollateral(new BN(2_000_000))
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
          collateralVault: ctx.collateralVault,
          userCollateralAta: userCol,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const userBor = getAssociatedTokenAddressSync(ctx.borrowMint.publicKey, owner);
      await ctx.program.methods
        .borrow(new BN(500_000))
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          deskLedger: ctx.deskLedgerPda,
          borrowerPosition: borrowerPda,
          borrowVault: ctx.borrowVault,
          userBorrowAta: userBor,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      const drain = Keypair.generate();
      await fundLamportsFromPayer(
        ctx.connection,
        ctx.payer,
        drain.publicKey,
        10_000_000,
      );
      const dumpAta = await ensureAta(
        ctx.connection,
        ctx.payer,
        drain.publicKey,
        ctx.borrowMint.publicKey,
      );
      const borBal = await getAccount(ctx.connection, userBor);
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createTransferInstruction(
            userBor,
            dumpAta,
            owner,
            borBal.amount,
            [],
            TOKEN_PROGRAM_ID,
          ),
        ),
        [ctx.payer],
      );

      try {
        await ctx.program.methods
          .repay(new BN(1))
          .accountsPartial({
            owner,
            desk: ctx.deskPda,
            deskLedger: ctx.deskLedgerPda,
            borrowerPosition: borrowerPda,
            borrowVault: ctx.borrowVault,
            userBorrowAta: userBor,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc();
        assert.fail("expected repay to fail");
      } catch (e) {
        assertInsufficientRollupSplAta(e);
      }
    });

    it("withdraw_lp: InsufficientRollupSplAta when LP ATA is empty", async () => {
      const ctx = await setupDesk();
      const owner = ctx.payer.publicKey;
      const lenderBorrowAta = await ensureAta(
        ctx.connection,
        ctx.payer,
        owner,
        ctx.borrowMint.publicKey,
      );
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createMintToInstruction(
            ctx.borrowMint.publicKey,
            lenderBorrowAta,
            ctx.payer.publicKey,
            5_000_000n,
          ),
        ),
        [ctx.payer],
      );
      await seedPoolWithLenderDeposit(ctx, owner, new BN(2_000_000));

      const lenderPda = deriveLender(ctx.program.programId, ctx.deskPda, owner);
      const lenderLpAta = getAssociatedTokenAddressSync(ctx.lpMintPda, owner);

      const drain = Keypair.generate();
      await fundLamportsFromPayer(
        ctx.connection,
        ctx.payer,
        drain.publicKey,
        10_000_000,
      );
      const dumpLpAta = await ensureAta(
        ctx.connection,
        ctx.payer,
        drain.publicKey,
        ctx.lpMintPda,
      );
      const lpBal = await getAccount(ctx.connection, lenderLpAta);
      await sendAndConfirmTransaction(
        ctx.connection,
        new Transaction().add(
          createTransferInstruction(
            lenderLpAta,
            dumpLpAta,
            owner,
            lpBal.amount,
            [],
            TOKEN_PROGRAM_ID,
          ),
        ),
        [ctx.payer],
      );

      try {
        await ctx.program.methods
          .withdrawLp(new BN(1))
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
        assert.fail("expected withdraw_lp to fail");
      } catch (e) {
        assertInsufficientRollupSplAta(e);
      }
    });
  });

  describe("health_tick_borrower", () => {
    let ctx: DeskCtx;

    before(async () => {
      ctx = await setupDesk();
    });

    it("runs for borrower position", async () => {
      const owner = ctx.payer.publicKey;
      const borrowerPda = deriveBorrower(ctx.program.programId, ctx.deskPda, owner);
      await ctx.program.methods
        .openBorrower()
        .accountsPartial({
          owner,
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
          permissionBorrower: permissionPdaFromAccount(borrowerPda),
          permissionProgram: PERMISSION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await ctx.program.methods
        .healthTickBorrower()
        .accountsPartial({
          desk: ctx.deskPda,
          borrowerPosition: borrowerPda,
        })
        .rpc();
    });
  });
});
