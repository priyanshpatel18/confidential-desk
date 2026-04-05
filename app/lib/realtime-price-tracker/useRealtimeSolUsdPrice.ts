"use client";

/**
 * SOL/USD stream using the same RPC + oracle account pattern as the sibling
 * `realtime-price-tracker` repo (`Connection` + `onAccountChange`).
 * Self-contained under `lib/realtime-price-tracker/` (no Haven / desk imports).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Connection } from "@solana/web3.js";

import { getRealtimeSolFeedConfig } from "./config";
import { parseSolUsdFromOracleAccount } from "./oracle";
import {
  directionFromUtcDayOpen,
  utcDayChangePct,
  utcDayOpenUsd,
  type SolPriceDirection,
} from "./utc-day-baseline";

export type { SolPriceDirection };

/** Coalesce oracle ticks so the header does not rerender on every slot. */
const DISPLAY_UPDATE_MIN_MS = 5_000;

export function useRealtimeSolUsdPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [direction, setDirection] = useState<SolPriceDirection>("flat");
  const [utcDayChangePctState, setUtcDayChangePctState] = useState<
    number | null
  >(null);

  const lastPaintMs = useRef(0);
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paint = useCallback((p: number) => {
    const open = utcDayOpenUsd(p);
    setDirection(directionFromUtcDayOpen(p, open));
    setUtcDayChangePctState(utcDayChangePct(p, open));
    setPrice(p);
    lastPaintMs.current = Date.now();
  }, []);

  useEffect(() => {
    const { rpc, account } = getRealtimeSolFeedConfig();
    const connection = new Connection(rpc, { commitment: "confirmed" });

    const apply = (data: Uint8Array) => {
      try {
        const p = parseSolUsdFromOracleAccount(data);
        const now = Date.now();
        const elapsed = now - lastPaintMs.current;

        if (elapsed >= DISPLAY_UPDATE_MIN_MS) {
          if (pendingTimer.current) {
            clearTimeout(pendingTimer.current);
            pendingTimer.current = null;
          }
          paint(p);
          return;
        }

        if (pendingTimer.current) clearTimeout(pendingTimer.current);
        const delay = DISPLAY_UPDATE_MIN_MS - elapsed;
        pendingTimer.current = setTimeout(() => {
          pendingTimer.current = null;
          try {
            paint(p);
          } catch {
            /* ignore */
          }
        }, delay);
      } catch {
        /* bad layout */
      }
    };

    let sub: number | undefined;

    void (async () => {
      try {
        const info = await connection.getAccountInfo(account, "confirmed");
        if (info?.data) {
          try {
            paint(parseSolUsdFromOracleAccount(info.data));
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }

      sub = connection.onAccountChange(
        account,
        (info) => apply(info.data),
        { commitment: "confirmed" },
      );
    })();

    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      if (sub != null) {
        void connection.removeAccountChangeListener(sub);
      }
    };
  }, [paint]);

  return {
    price,
    direction,
    utcDayChangePct: utcDayChangePctState,
  };
}
