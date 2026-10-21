import { THREADS_MAX_LENGTH } from "@/lib/threads/length";
import { cn } from "@/lib/utils";

/** Threads-style length ring: fills as you type, shows what's left near the limit. */
export function CounterRing({ length }: { length: number }) {
  const ratio = Math.min(1, length / THREADS_MAX_LENGTH);
  const left = THREADS_MAX_LENGTH - length;
  const r = 9;
  const circumference = 2 * Math.PI * r;
  const tone = left < 0 ? "text-negative" : left <= 50 ? "text-accent" : "text-subtle";
  return (
    <span className={cn("flex items-center gap-1.5 font-mono text-xs tabular", tone)}>
      <svg viewBox="0 0 24 24" className="size-5 -rotate-90" aria-hidden>
        <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={3} />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
          className="transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      <span aria-live="polite">
        {left <= 50 ? left : length}
        <span className="sr-only"> {left <= 50 ? "characters left" : `of ${THREADS_MAX_LENGTH} characters`}</span>
      </span>
    </span>
  );
}
