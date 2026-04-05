"use client";

import { BN } from "@coral-xyz/anchor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import rawIdl from "@/lib/confidential_desk.json";
import {
  activatePosition,
  borrow,
  closePosition,
  depositCollateral,
  repay,
  withdrawCollateral,
} from "@/lib/desk-actions";
import type { ConfidentialLendingDeskModel } from "@/hooks/use-confidential-lending-desk";

export function BorrowTab({ desk }: { desk: ConfidentialLendingDeskModel }) {
  const {
    labels,
    formDisabled,
    connection,
    anchorWallet,
    signMessage,
    borrowerNeedsActivate,
    depositColIn,
    setDepositColIn,
    borrowWantIn,
    setBorrowWantIn,
    repayIn,
    setRepayIn,
    withdrawColIn,
    setWithdrawColIn,
    deskSnap,
    borrowDerived,
    portfolio,
    runWithEr,
    signMessageSafe,
    toRawAmount,
    formatRaw,
  } = desk;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Borrow against shielded {labels.collateral}</CardTitle>
        <CardDescription>
          Deposit collateral and borrow {labels.borrow} on the rollup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {borrowerNeedsActivate && (
          <Button
            disabled={formDisabled || !anchorWallet || !signMessage}
            onClick={() =>
              void runWithEr("Activate borrower…", () =>
                activatePosition({
                  connection,
                  wallet: anchorWallet!,
                  signMessage: signMessageSafe,
                  rawIdl,
                  kind: "borrower",
                }),
              )
            }
          >
            Activate borrower position
          </Button>
        )}
        <div className="space-y-2">
          <Label>Deposit collateral (shielded {labels.collateral})</Label>
          <Input
            value={depositColIn}
            onChange={(e) => setDepositColIn(e.target.value)}
            disabled={formDisabled || borrowerNeedsActivate}
          />
          <Button
            disabled={formDisabled || borrowerNeedsActivate}
            onClick={() => {
              if (!anchorWallet) return;
              const raw = toRawAmount(
                depositColIn,
                portfolio.collateralDecimals,
              );
              if (raw.lte(new BN(0))) return;
              void runWithEr("Deposit collateral…", () =>
                depositCollateral({
                  connection,
                  wallet: anchorWallet!,
                  signMessage: signMessageSafe,
                  rawIdl,
                  amount: raw,
                }),
              );
            }}
          >
            Deposit collateral
          </Button>
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>Borrow {labels.borrow}</Label>
          <Input
            value={borrowWantIn}
            onChange={(e) => setBorrowWantIn(e.target.value)}
            disabled={formDisabled || borrowerNeedsActivate}
          />
          <p className="text-muted-foreground text-xs">
            Max by LTV + liquidity:{" "}
            {deskSnap
              ? formatRaw(
                  borrowDerived.maxBorrowAllowedRaw,
                  portfolio.borrowDecimals,
                )
              : "—"}
          </p>
          <Button
            disabled={formDisabled || borrowerNeedsActivate}
            onClick={() => {
              if (!anchorWallet) return;
              const amt = borrowDerived.effBorrow;
              if (amt.lte(new BN(0))) return;
              void runWithEr("Borrow…", () =>
                borrow({
                  connection,
                  wallet: anchorWallet!,
                  signMessage: signMessageSafe,
                  rawIdl,
                  amount: amt,
                }),
              );
            }}
          >
            Borrow
          </Button>
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>Repay {labels.borrow}</Label>
          <Input
            value={repayIn}
            onChange={(e) => setRepayIn(e.target.value)}
            disabled={formDisabled || borrowerNeedsActivate}
          />
          <Button
            variant="secondary"
            disabled={formDisabled || borrowerNeedsActivate}
            onClick={() => {
              if (!anchorWallet) return;
              const raw = toRawAmount(repayIn, portfolio.borrowDecimals);
              if (raw.lte(new BN(0))) return;
              void runWithEr("Repay…", () =>
                repay({
                  connection,
                  wallet: anchorWallet!,
                  signMessage: signMessageSafe,
                  rawIdl,
                  amount: raw,
                }),
              );
            }}
          >
            Repay
          </Button>
        </div>
        <div className="space-y-2">
          <Label>Withdraw collateral</Label>
          <Input
            value={withdrawColIn}
            onChange={(e) => setWithdrawColIn(e.target.value)}
            disabled={formDisabled || borrowerNeedsActivate}
          />
          <Button
            variant="outline"
            disabled={formDisabled || borrowerNeedsActivate}
            onClick={() => {
              if (!anchorWallet) return;
              const raw = toRawAmount(
                withdrawColIn,
                portfolio.collateralDecimals,
              );
              if (raw.lte(new BN(0))) return;
              void runWithEr("Withdraw collateral…", () =>
                withdrawCollateral({
                  connection,
                  wallet: anchorWallet!,
                  signMessage: signMessageSafe,
                  rawIdl,
                  amount: raw,
                }),
              );
            }}
          >
            Withdraw collateral
          </Button>
        </div>
        {portfolio.position && (
          <div className="text-muted-foreground text-xs space-y-1">
            <div>
              Collateral:{" "}
              {formatRaw(
                portfolio.position.collateralAmount,
                portfolio.collateralDecimals,
              )}
            </div>
            <div>
              Debt:{" "}
              {formatRaw(
                portfolio.position.debtAmount,
                portfolio.borrowDecimals,
              )}
            </div>
            {portfolio.position.isLiquidatable && (
              <Badge variant="destructive">Liquidatable</Badge>
            )}
          </div>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={formDisabled || borrowerNeedsActivate}
          onClick={() => {
            if (!anchorWallet) return;
            void runWithEr("Close borrower…", () =>
              closePosition({
                wallet: anchorWallet!,
                signMessage: signMessageSafe,
                rawIdl,
                kind: "borrower",
              }),
            );
          }}
        >
          Close borrower (zero debt & collateral)
        </Button>
      </CardContent>
    </Card>
  );
}
