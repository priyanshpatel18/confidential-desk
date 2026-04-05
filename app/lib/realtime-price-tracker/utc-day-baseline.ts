/** localStorage namespace for %‑since‑UTC‑day open (isolated from other app keys). */
const LS_UTC_DAY = "rpt_sol_utc_day";
const LS_UTC_OPEN = "rpt_sol_utc_open_usd";

function utcCalendarDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function readStoredUtcOpen(): { day: string; open: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const day = localStorage.getItem(LS_UTC_DAY);
    const openStr = localStorage.getItem(LS_UTC_OPEN);
    if (!day || !openStr) return null;
    const open = Number(openStr);
    if (!Number.isFinite(open) || open <= 0) return null;
    return { day, open };
  } catch {
    return null;
  }
}

function writeStoredUtcOpen(day: string, open: number) {
  try {
    localStorage.setItem(LS_UTC_DAY, day);
    localStorage.setItem(LS_UTC_OPEN, String(open));
  } catch {
    /* quota / private mode */
  }
}

export type SolPriceDirection = "up" | "down" | "flat";

/** First tick after UTC midnight becomes the day’s baseline (persisted). */
export function utcDayOpenUsd(price: number): number {
  const today = utcCalendarDateString();
  const stored = readStoredUtcOpen();
  if (!stored || stored.day !== today) {
    writeStoredUtcOpen(today, price);
    return price;
  }
  return stored.open;
}

export function directionFromUtcDayOpen(
  price: number,
  open: number,
): SolPriceDirection {
  if (!Number.isFinite(price) || !Number.isFinite(open) || open <= 0) {
    return "flat";
  }
  const rel = (price - open) / open;
  if (Math.abs(rel) < 1e-8) return "flat";
  return rel > 0 ? "up" : "down";
}

export function utcDayChangePct(price: number, open: number): number | null {
  if (!Number.isFinite(open) || open <= 0) return null;
  return ((price - open) / open) * 100;
}
