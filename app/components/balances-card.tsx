"use client";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { ConfidentialLendingDeskModel } from "@/hooks/use-confidential-lending-desk";
import {
    formatSolLineFromRaw,
    formatUsdcLineFromRaw,
} from "@/lib/format-shield-amounts";

import { SOL_ICON_SRC, TokenIcon, UsdcIcon } from "./desk-icons";

export function BalancesCard({ desk }: { desk: ConfidentialLendingDeskModel }) {
  const {
    portfolio,
    connected,
    publicKey,
    signTransaction,
    canUnwrapWsolUi,
    unwrapWsolBusy,
    runUnwrapAllWsol,
    labels,
  } = desk;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Balances</CardTitle>
        <CardDescription>
          Native SOL and USDC on Solana, plus shielded (PER) balances.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
            <TokenIcon src={SOL_ICON_SRC} className="size-4" />
            SOL (native)
          </div>
          <div className="font-mono text-lg tabular-nums">
            {portfolio.nativeSolBal} SOL
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
              <TokenIcon src={SOL_ICON_SRC} className="size-4" />
              WSOL (base)
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 rounded-md px-2.5 text-xs"
              disabled={
                !connected ||
                !publicKey ||
                !signTransaction ||
                !canUnwrapWsolUi ||
                unwrapWsolBusy
              }
              onClick={() => {
                void runUnwrapAllWsol();
              }}
            >
              {unwrapWsolBusy ? "Unwrapping…" : "Unwrap"}
            </Button>
          </div>
          <div className="font-mono text-lg tabular-nums">
            {portfolio.collateralBal} {labels.collateral}
          </div>
          <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
            Unwrap → native SOL
          </p>
        </div>
        <div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
            <UsdcIcon className="size-4" />
            {labels.borrow}
          </div>
          <div className="font-mono text-lg tabular-nums">
            {portfolio.borrowBal} USDC
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-xs uppercase">LP shares</div>
          <div className="font-mono text-lg">{portfolio.lpBal}</div>
        </div>
        <Separator className="sm:col-span-2" />
        <div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
            <TokenIcon src={SOL_ICON_SRC} className="size-4" />
            Shielded {labels.shieldedCollateral}
          </div>
          <div className="font-mono text-lg tabular-nums">
            {formatSolLineFromRaw(portfolio.shieldedCollateral)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground flex items-center gap-2 text-xs uppercase">
            <UsdcIcon className="size-4" />
            Shielded {labels.borrow}
          </div>
          <div className="font-mono text-lg tabular-nums">
            {formatUsdcLineFromRaw(portfolio.shieldedBorrow)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
