"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ConfidentialLendingDeskModel } from "@/hooks/use-confidential-lending-desk";
import { cn } from "@/lib/utils";

import { SOL_ICON_SRC, TokenIcon, UsdcIcon } from "./desk-icons";

export function ShieldTab({ desk }: { desk: ConfidentialLendingDeskModel }) {
  const {
    labels,
    formDisabled,
    shieldAsset,
    setShieldAsset,
    perFlowAmount,
    setPerFlowAmount,
    setErr,
    perHalfButtonDisabled,
    perMaxDisabledRaw,
    perPrimaryDisabled,
    setHalfForPerFlow,
    setMaxForPerFlow,
    shieldMode,
    setShieldMode,
    busy,
    runPerShieldFlow,
    inputClass,
    sanitizeDecimalInput,
    USDC_DECIMALS,
    SOL_DECIMALS,
  } = desk;

  return (
    <Card className="border-border bg-card/80 shadow-lg shadow-black/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Private payments</CardTitle>
        <CardDescription className="text-xs">
          Move tokens between base Solana and the PER rollup.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="inline-flex items-center gap-2">
            {shieldAsset === "usdc" ? (
              <UsdcIcon className="size-4" />
            ) : (
              <TokenIcon src={SOL_ICON_SRC} className="size-4" />
            )}
            Mint
          </Label>
          <select
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            value={shieldAsset}
            disabled={formDisabled}
            onChange={(e) => {
              setShieldAsset(e.target.value as "sol" | "usdc");
              setErr(null);
            }}
          >
            <option value="sol">{labels.collateral}</option>
            <option value="usdc">{labels.borrow}</option>
          </select>
        </div>

        <div>
          <label className="text-muted-foreground mb-1 block text-[11px] font-medium">
            Amount
          </label>
          <div className="border-border bg-input/30 focus-within:border-ring flex items-center gap-2 rounded-xl border pr-2 focus-within:ring-[3px] focus-within:ring-ring/50">
            <input
              type="text"
              inputMode="decimal"
              className={inputClass}
              placeholder="0.00"
              value={perFlowAmount}
              disabled={formDisabled}
              onChange={(e) =>
                setPerFlowAmount(
                  sanitizeDecimalInput(
                    e.target.value,
                    shieldAsset === "usdc" ? USDC_DECIMALS : SOL_DECIMALS,
                  ),
                )
              }
            />
            <span className="text-muted-foreground shrink-0 text-sm font-semibold">
              {shieldAsset === "usdc" ? labels.borrow : labels.collateral}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                disabled={perHalfButtonDisabled}
                onClick={setHalfForPerFlow}
              >
                Half
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                disabled={formDisabled || perMaxDisabledRaw}
                onClick={setMaxForPerFlow}
              >
                Max
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground mt-1 text-[11px]">
            {shieldMode === "shield"
              ? shieldAsset === "usdc"
                ? "Half / Max use your public USDC (wallet ATA)."
                : "Half / Max use WSOL plus spendable native SOL; shield adds wrap instructions in the same tx when needed."
              : shieldAsset === "usdc"
                ? "Half / Max use your private PER USDC; unshield returns it to base."
                : "Half / Max use your private PER SOL. Unshield is one signature; funds arrive as WSOL on base (see Balances)."}
          </p>
        </div>

        <div
          className="flex rounded-xl border border-border bg-muted/40 p-1"
          role="tablist"
          aria-label="Action"
        >
          {(
            [
              ["shield", "Shield"],
              ["unshield", "Unshield"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={shieldMode === m}
              disabled={formDisabled}
              className={cn(
                "flex-1 rounded-lg py-2.5 text-center text-xs font-semibold transition-colors",
                shieldMode === m
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setShieldMode(m);
                setErr(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <Button
          variant="default"
          size="lg"
          className="w-full rounded-xl"
          disabled={perPrimaryDisabled}
          onClick={() => void runPerShieldFlow()}
        >
          {busy ? "Signing…" : shieldMode === "shield" ? "Shield" : "Unshield"}
        </Button>
      </CardContent>
    </Card>
  );
}
