"use client";

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
import type { ConfidentialLendingDeskModel } from "@/hooks/use-confidential-lending-desk";

import { SOL_ICON_SRC, TokenIcon, UsdcIcon } from "./desk-icons";

export function PrivateSendTab({
  desk,
}: {
  desk: ConfidentialLendingDeskModel;
}) {
  const {
    labels,
    formDisabled,
    privateSendAsset,
    setPrivateSendAsset,
    privateSendTo,
    setPrivateSendTo,
    privateSendAmount,
    setPrivateSendAmount,
    setErr,
    privateSendHalfButtonDisabled,
    privateSendMaxButtonDisabled,
    privateSendPrimaryDisabled,
    setHalfForPrivateSend,
    setMaxForPrivateSend,
    busy,
    runPerPrivateSendFlow,
    inputClass,
    sanitizeDecimalInput,
    USDC_DECIMALS,
    SOL_DECIMALS,
  } = desk;

  return (
    <Card className="border-border bg-card/80 shadow-lg shadow-black/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Private send on PER</CardTitle>
        <CardDescription className="text-xs">
          Send shielded balance to another wallet on the rollup using the MagicBlock
          Private Payments API (
          <span className="font-mono text-[11px]">ephemeral → ephemeral</span>
          , private).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label className="inline-flex items-center gap-2">
            {privateSendAsset === "usdc" ? (
              <UsdcIcon className="size-4" />
            ) : (
              <TokenIcon src={SOL_ICON_SRC} className="size-4" />
            )}
            Mint
          </Label>
          <select
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            value={privateSendAsset}
            disabled={formDisabled}
            onChange={(e) => {
              setPrivateSendAsset(e.target.value as "sol" | "usdc");
              setErr(null);
            }}
          >
            <option value="sol">{labels.collateral}</option>
            <option value="usdc">{labels.borrow}</option>
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="private-send-to">Recipient</Label>
          <Input
            id="private-send-to"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Solana address (base58)"
            className="font-mono text-sm"
            disabled={formDisabled}
            value={privateSendTo}
            onChange={(e) => {
              setPrivateSendTo(e.target.value);
              setErr(null);
            }}
          />
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
              value={privateSendAmount}
              disabled={formDisabled}
              onChange={(e) =>
                setPrivateSendAmount(
                  sanitizeDecimalInput(
                    e.target.value,
                    privateSendAsset === "usdc"
                      ? USDC_DECIMALS
                      : SOL_DECIMALS,
                  ),
                )
              }
            />
            <span className="text-muted-foreground shrink-0 text-sm font-semibold">
              {privateSendAsset === "usdc"
                ? labels.borrow
                : labels.collateral}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                disabled={privateSendHalfButtonDisabled}
                onClick={setHalfForPrivateSend}
              >
                Half
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                disabled={privateSendMaxButtonDisabled}
                onClick={setMaxForPrivateSend}
              >
                Max
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Half / Max use your shielded PER balance for the selected mint.
            Recipient must be a different wallet.
          </p>
        </div>

        <Button
          variant="default"
          size="lg"
          className="w-full rounded-xl"
          disabled={privateSendPrimaryDisabled}
          onClick={() => void runPerPrivateSendFlow()}
        >
          {busy ? "Signing…" : "Private send"}
        </Button>
      </CardContent>
    </Card>
  );
}
