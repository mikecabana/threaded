import { zonedParts } from "@/lib/analysis/time";
import { cn } from "@/lib/utils";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Up to four dots per day; more posts than that still show four. */
const DOTS = ["a", "b", "c", "d"];

export const dayKey = (date: Date, timeZone: string) => {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/** The next seven days at a glance: how many posts each holds. Days with posts link to their group. */
export function WeekStrip({ scheduled, timeZone, now }: { scheduled: Date[]; timeZone: string; now: Date }) {
  const counts = new Map<string, number>();
  for (const at of scheduled) counts.set(dayKey(at, timeZone), (counts.get(dayKey(at, timeZone)) ?? 0) + 1);
  const days = Array.from({ length: 7 }, (_, i) => new Date(now.getTime() + i * DAY_MS));

  return (
    <nav aria-label="This week" className="grid grid-cols-7 gap-1.5">
      {days.map((day, i) => {
        const key = dayKey(day, timeZone);
        const parts = zonedParts(day, timeZone);
        const count = counts.get(key) ?? 0;
        const label = `${WEEKDAYS[parts.weekday]} ${parts.day}: ${count === 0 ? "nothing" : count === 1 ? "1 post" : `${count} posts`}`;
        const body = (
          <>
            <span className="text-[11px] text-subtle uppercase tracking-wide">
              {i === 0 ? "Today" : WEEKDAYS[parts.weekday]}
            </span>
            <span className="font-semibold text-lg tabular">{parts.day}</span>
            <span className="flex h-2 items-center gap-0.5" aria-hidden>
              {DOTS.slice(0, count).map((dot) => (
                <span key={dot} className="size-1.5 rounded-full bg-accent" />
              ))}
            </span>
          </>
        );
        const className = cn(
          "flex flex-col items-center gap-0.5 rounded-xl border py-2 transition-colors",
          i === 0 ? "border-accent/50 bg-accent/5" : "border-border",
          count > 0 && "hover:border-accent/60",
        );
        return count > 0 ? (
          <a key={key} href={`#day-${key}`} aria-label={label} className={className}>
            {body}
          </a>
        ) : (
          <div key={key} aria-label={label} role="img" className={className}>
            {body}
          </div>
        );
      })}
    </nav>
  );
}
