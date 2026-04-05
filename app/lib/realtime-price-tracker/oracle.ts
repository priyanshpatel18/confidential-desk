/**
 * Oracle wire format — kept in sync with
 * `realtime-price-tracker/components/price-tracker.tsx` (bytes 73–81, i64 LE, scale 1e8).
 */
export function parseSolUsdFromOracleAccount(data: Uint8Array): number {
  const bytes = data.slice(73, 81);
  const quantizedValueBigInt = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getBigInt64(0, true);
  return Number(quantizedValueBigInt) / 100_000_000;
}
