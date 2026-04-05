"use client";

import { BN } from "@coral-xyz/anchor";
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
  computeLpMintedForDeposit,
  depositLiquidity,
  DESK_LEDGER_INACTIVE_PREFIX,
  initDeskVaults,
  withdrawLp,
} from "@/lib/desk-actions";
import type { ConfidentialLendingDeskModel } from "@/hooks/use-confidential-lending-desk";
import { USDC_DECIMALS } from "@/lib/format-shield-amounts";

export function LendTab({ desk }: { desk: ConfidentialLendingDeskModel }) {
  const {
    labels,
    formDisabled,
    connection,
    anchorWallet,
    signMessage,
    ledgerDelegated,
    lenderNeedsActivate,
    lendAmount,
    setLendAmount,
    withdrawLpIn,
    setWithdrawLpIn,
    setErr,
    lendHalfButtonDisabled,
    lendMaxButtonDisabled,
    lendDepositPrimaryDisabled,
    setHalfForLendDeposit,
    setMaxForLendDeposit,
    runWithBase,
    runWithEr,
    signMessageSafe,
    lendMaxShieldedRaw,
    deskSnap,
    portfolio,
    humanTokenToRaw,
    sanitizeDecimalInput,
    inputClass,
    toRawAmount,
    formatRaw,
  } = desk;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Lend shielded {labels.borrow}</CardTitle>
        <CardDescription>
          Deposit liquidity on the rollup and receive LP. Vault ATAs are created on
          Solana base (same as RPS tests); desk ledger must be delegated on base once
          (creator wallet).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!ledgerDelegated && (
          <p className="text-muted-foreground text-sm">
            {DESK_LEDGER_INACTIVE_PREFIX} The desk authority must connect once and
            activate a position so `desk_ledger` delegates to the rollup.
          </p>
        )}
        <Button
          variant="outline"
          disabled={formDisabled || !anchorWallet}
          onClick={() =>
            void runWithBase("Init desk vaults on base…", () =>
              initDeskVaults({
                connection,
                wallet: anchorWallet!,
              }),
            )
          }
        >
          Init desk vaults (base)
        </Button>
        {lenderNeedsActivate && (
          <Button
            disabled={formDisabled || !anchorWallet || !signMessage}
            onClick={() =>
              void runWithEr("Activate lender…", () =>
                activatePosition({
                  connection,
                  wallet: anchorWallet!,
                  signMessage: signMessageSafe,
                  rawIdl,
                  kind: "lender",
                }),
              )
            }
          >
            Activate lender position
          </Button>
        )}
        <div className="space-y-2">
          <Label>Deposit amount ({labels.borrow})</Label>
          <div className="border-border bg-input/30 focus-within:border-ring flex items-center gap-2 rounded-xl border pr-2 focus-within:ring-[3px] focus-within:ring-ring/50">
            <input
              type="text"
              inputMode="decimal"
              className={inputClass}
              placeholder="0.00"
              value={lendAmount}
              disabled={formDisabled || lenderNeedsActivate}
              onChange={(e) => {
                setErr(null);
                setLendAmount(sanitizeDecimalInput(e.target.value, USDC_DECIMALS));
              }}
            />
            <span className="text-muted-foreground shrink-0 text-sm font-semibold">
              {labels.borrow}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                disabled={lendHalfButtonDisabled}
                onClick={setHalfForLendDeposit}
              >
                Half
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                disabled={lendMaxButtonDisabled}
                onClick={setMaxForLendDeposit}
              >
                Max
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground text-[11px]">
            Half / Max use your shielded PER {labels.borrow} balance. You cannot
            deposit more than that from private balance.
          </p>
          <Button
            disabled={lendDepositPrimaryDisabled}
            onClick={() => {
              if (!anchorWallet || !deskSnap) return;
              setErr(null);
              const rawBig = humanTokenToRaw(lendAmount.trim(), USDC_DECIMALS);
              if (
                rawBig === null ||
                rawBig < BigInt(1) ||
                rawBig > BigInt(Number.MAX_SAFE_INTEGER)
              ) {
                setErr("Enter a valid amount.");
                return;
              }
              if (
                lendMaxShieldedRaw === null ||
                rawBig > lendMaxShieldedRaw
              ) {
                setErr(
                  `Amount exceeds shielded ${labels.borrow}. Shield more on the Shield tab first.`,
                );
                return;
              }
              const raw = new BN(rawBig.toString());
              const lpToMint = computeLpMintedForDeposit(
                raw,
                deskSnap.totalDeposits,
                deskSnap.lpTotalMinted,
              );
              void runWithEr("Deposit liquidity…", () =>
                depositLiquidity({
                  connection,
                  wallet: anchorWallet,
                  signMessage: signMessageSafe,
                  rawIdl,
                  amount: raw,
                  lpToMint,
                }),
              );
            }}
          >
            Deposit liquidity
          </Button>
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>Withdraw LP</Label>
          <Input
            value={withdrawLpIn}
            onChange={(e) => setWithdrawLpIn(e.target.value)}
            disabled={formDisabled || lenderNeedsActivate}
          />
          <Button
            variant="secondary"
            disabled={formDisabled || lenderNeedsActivate}
            onClick={() => {
              if (!anchorWallet) return;
              const raw = toRawAmount(withdrawLpIn, portfolio.lpDecimals);
              if (raw.lte(new BN(0))) return;
              void runWithEr("Withdraw LP…", () =>
                withdrawLp({
                  connection,
                  wallet: anchorWallet!,
                  signMessage: signMessageSafe,
                  rawIdl,
                  shares: raw,
                }),
              );
            }}
          >
            Withdraw LP
          </Button>
        </div>
        {portfolio.lender && (
          <p className="text-muted-foreground text-xs">
            Lender deposit (notional):{" "}
            {formatRaw(portfolio.lender.depositAmount, portfolio.borrowDecimals)} ·
            LP: {formatRaw(portfolio.lender.lpShares, portfolio.lpDecimals)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
