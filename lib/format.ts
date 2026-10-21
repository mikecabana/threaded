export type MetricFormat = "number" | "compact" | "percent" | "decimal" | "multiplier";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Formats a metric for display. Percent values are fractions (0.048 → "4.8%"). */
export function formatMetric(value: number, format: MetricFormat): string {
  if (!Number.isFinite(value)) return "–";
  switch (format) {
    case "number":
      return whole.format(value);
    case "compact":
      return Math.abs(value) < 10_000 ? whole.format(value) : compact.format(value).toLowerCase();
    case "percent":
      return `${oneDecimal.format(value * 100)}%`;
    case "decimal":
      return oneDecimal.format(value);
    case "multiplier":
      return `${oneDecimal.format(value)}×`;
  }
}

/** Threads-style relative time: "45m", "3h", "2d", then "Oct 2". */
export function timeAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Signed change for a delta chip. Percent deltas are fractions; "pts" deltas are percentage points. */
export function formatDelta(delta: number, kind: "percent" | "points" | "absolute"): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  const abs = Math.abs(delta);
  switch (kind) {
    case "percent":
      return `${sign}${oneDecimal.format(abs * 100)}%`;
    case "points":
      return `${sign}${oneDecimal.format(abs * 100)} pts`;
    case "absolute":
      return `${sign}${compact.format(abs)}`;
  }
}
