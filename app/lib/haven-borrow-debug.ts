/**
 * Verbose borrow / rollup / desk logging. Filter DevTools console by `[haven:borrow]`.
 * - On automatically when `NODE_ENV === "development"`.
 * - Or set `NEXT_PUBLIC_HAVEN_BORROW_DEBUG=1` in `.env` (any build).
 */

function borrowDebugEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.NEXT_PUBLIC_HAVEN_BORROW_DEBUG === "1"
  );
}

/** Use when branching (e.g. only build expensive log payloads if true). */
export function isBorrowDebugEnabled(): boolean {
  return borrowDebugEnabled();
}

/** Strip `token=` from rollup URLs before logging. */
export function redactRpcUrl(url: string): string {
  return url.replace(/([?&])token=[^&]+/gi, "$1token=<redacted>");
}

export function borrowLog(...args: unknown[]): void {
  if (!borrowDebugEnabled()) return;
  console.log("[haven:borrow]", new Date().toISOString(), ...args);
}

export function borrowWarn(...args: unknown[]): void {
  if (!borrowDebugEnabled()) return;
  console.warn("[haven:borrow]", new Date().toISOString(), ...args);
}

export function borrowError(...args: unknown[]): void {
  if (!borrowDebugEnabled()) return;
  console.error("[haven:borrow]", new Date().toISOString(), ...args);
}

export function borrowLogError(context: string, e: unknown): void {
  if (!borrowDebugEnabled()) return;
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e !== null
        ? (() => {
            try {
              return JSON.stringify(e);
            } catch {
              return String(e);
            }
          })()
        : String(e);
  const stack = e instanceof Error ? e.stack : undefined;
  const extra =
    typeof e === "object" && e !== null
      ? {
          code: (e as { code?: unknown }).code,
          signature: (e as { signature?: unknown }).signature,
        }
      : {};
  console.error("[haven:borrow]", context, msg, extra, stack ?? "");
}
