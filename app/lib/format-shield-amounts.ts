/** Human ↔ smallest-unit conversions for PER shield UI (SOL = 9 dp, USDC = 6 dp). */

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;

export function parseRawBalanceIntString(s: string): bigint | null {
  const t = s.trim();
  if (!t || t === "—" || t === "Error") return null;
  if (!/^\d+$/.test(t)) return null;
  try {
    return BigInt(t);
  } catch {
    return null;
  }
}

export function rawToHuman(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const d = BigInt(10) ** BigInt(decimals);
  const intPart = amount / d;
  const frac = amount % d;
  if (frac === BigInt(0)) return intPart.toString();
  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${intPart}.${fracStr}`;
}

/**
 * Parse user amount (e.g. `1`, `0.5`, `.25`) into raw units.
 * Returns null if empty, invalid, or more than `maxFracDigits` fractional digits.
 */
export function humanTokenToRaw(
  human: string,
  maxFracDigits: number,
): bigint | null {
  let t = human.trim().replace(/\s/g, "");
  if (!t) return null;
  if (t === ".") return null;
  if (t.startsWith(".")) t = `0${t}`;
  const parts = t.split(".");
  if (parts.length > 2) return null;
  const wholeStr = parts[0] ?? "";
  const fracPart = parts[1] ?? "";
  if (fracPart.length > maxFracDigits) return null;
  if (wholeStr === "" && fracPart === "") return null;
  if (wholeStr !== "" && !/^\d+$/.test(wholeStr)) return null;
  if (fracPart !== "" && !/^\d+$/.test(fracPart)) return null;
  const wholeNorm =
    wholeStr === "" ? "0" : wholeStr.replace(/^0+/, "") || "0";
  const whole = BigInt(wholeNorm);
  const pad = fracPart + "0".repeat(maxFracDigits);
  const frac = BigInt(pad.slice(0, maxFracDigits));
  const mult = BigInt(10) ** BigInt(maxFracDigits);
  return whole * mult + frac;
}

/** Digits and one dot; cap fractional length. */
export function sanitizeDecimalInput(next: string, maxFracDigits: number): string {
  let v = next.replace(/[^0-9.]/g, "");
  const dot = v.indexOf(".");
  if (dot !== -1) {
    v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
    const [intSide, frac = ""] = v.split(".");
    return intSide + "." + frac.slice(0, maxFracDigits);
  }
  return v;
}

export function formatSolLineFromRaw(rawStr: string): string {
  const b = parseRawBalanceIntString(rawStr);
  if (b === null) return rawStr === "Error" ? "Error" : "—";
  return `${rawToHuman(b, SOL_DECIMALS)} SOL`;
}

export function formatUsdcLineFromRaw(rawStr: string): string {
  const b = parseRawBalanceIntString(rawStr);
  if (b === null) return rawStr === "Error" ? "Error" : "—";
  return `${rawToHuman(b, USDC_DECIMALS)} USDC`;
}
