// Turns AI Gateway failures into something the user can act on. Errors from
// streamText arrive wrapped (retry errors, API call errors), so look through
// causes for the Gateway's HTTP status.

export type ByokFailure = "byok_key_invalid" | "byok_no_balance";

export function gatewayStatus(error: unknown, depth = 0): number | null {
  if (!error || typeof error !== "object" || depth > 4) return null;
  const e = error as { statusCode?: unknown; cause?: unknown; lastError?: unknown; errors?: unknown };
  if (typeof e.statusCode === "number") return e.statusCode;
  for (const inner of [e.lastError, e.cause, ...(Array.isArray(e.errors) ? e.errors : [])]) {
    const status = gatewayStatus(inner, depth + 1);
    if (status !== null) return status;
  }
  return null;
}

/** Why a call on the user's own key failed, if it's something they can fix. */
export function byokFailure(error: unknown): ByokFailure | null {
  const status = gatewayStatus(error);
  if (status === 401 || status === 403) return "byok_key_invalid";
  if (status === 402) return "byok_no_balance";
  const message = error instanceof Error ? error.message : "";
  if (/insufficient (funds|credits|balance)/i.test(message)) return "byok_no_balance";
  return null;
}
