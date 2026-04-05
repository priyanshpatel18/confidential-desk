"use client";

import Image from "next/image";

import { useRealtimeSolUsdPrice } from "@/lib/realtime-price-tracker";

function formatSignedPct(pct: number): string {
  const sign = pct > 0 ? "+" : "";
  const abs = Math.abs(pct);
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 2 : 3;
  return `${sign}${pct.toFixed(digits)}%`;
}

export function SolPriceTicker() {
  const { price, direction, utcDayChangePct } = useRealtimeSolUsdPrice();

  const dirClass =
    direction === "up"
      ? "haven-sol-price-up"
      : direction === "down"
        ? "haven-sol-price-down"
        : "";

  return (
    <div className="haven-sol-price flex shrink-0 items-center gap-1.5 sm:gap-2">
      <Image
        src="/solana.svg"
        alt=""
        width={18}
        height={18}
        className="shrink-0 opacity-90"
      />
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        SOL
      </span>
      <span
        className={`haven-sol-price-value inline-flex items-baseline gap-1.5 font-mono text-sm font-semibold tabular-nums ${dirClass}`}
        title="Change since 00:00 UTC (baseline saved on first update each UTC day)"
      >
        {price != null ? (
          <>
            <span>{price.toFixed(2)}</span>
            {utcDayChangePct != null && direction !== "flat" ? (
              <span className="text-xs font-medium opacity-90">
                {formatSignedPct(utcDayChangePct)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">...</span>
        )}
      </span>
    </div>
  );
}
