import { hourLabel, weekdayName, zonedParts, zonedTimeToUtc } from "@/lib/analysis/time";

// Suggested times for the composer: the idea's own best slot, then the
// author's best hours, each at its next occurrence in the profile's timezone.

const DAY_MS = 86_400_000;
/** Don't suggest a slot that's about to pass. */
const MIN_LEAD_MS = 10 * 60_000;

export interface Slot {
  at: string;
  label: string;
  note: string;
}

/** The next time it's `hour`:00 (on `weekday`, if given) in `timeZone`, at least a few minutes out. */
export function nextOccurrence(slot: { weekday?: number; hour: number }, timeZone: string, now: Date): Date {
  for (let d = 0; d <= 7; d++) {
    const day = zonedParts(new Date(now.getTime() + d * DAY_MS), timeZone);
    if (slot.weekday !== undefined && day.weekday !== slot.weekday) continue;
    const at = zonedTimeToUtc({ year: day.year, month: day.month, day: day.day, hour: slot.hour, minute: 0 }, timeZone);
    if (at.getTime() >= now.getTime() + MIN_LEAD_MS) return at;
  }
  // Only reachable for the same weekday a week out with the hour already gone.
  return new Date(now.getTime() + 7 * DAY_MS);
}

/** "Today 7 PM", "Tomorrow 9 AM", "Tue 7 PM" (within a week), else "Oct 30, 7 PM". */
export function slotLabel(at: Date, timeZone: string, now: Date): string {
  const when = zonedParts(at, timeZone);
  const today = zonedParts(now, timeZone);
  const tomorrow = zonedParts(new Date(now.getTime() + DAY_MS), timeZone);
  const sameDay = (a: typeof when, b: typeof when) => a.year === b.year && a.month === b.month && a.day === b.day;
  const time =
    when.minute === 0 ? hourLabel(when.hour) : `${hourLabel(when.hour).replace(" ", `:${pad(when.minute)} `)}`;
  if (sameDay(when, today)) return `Today ${time}`;
  if (sameDay(when, tomorrow)) return `Tomorrow ${time}`;
  if (at.getTime() - now.getTime() < 6 * DAY_MS) return `${weekdayName(when.weekday)} ${time}`;
  const date = at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
  return `${date}, ${time}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

const RANK = ["your best hour", "your #2 hour", "your #3 hour"];

export function suggestedSlots(input: {
  /** The author's hours, best first (see rankHours). */
  bestHours: number[];
  /** The idea's own suggested slot, if it has one. */
  ideaSlot?: { weekday: number; hour: number } | null;
  timeZone: string;
  now: Date;
}): Slot[] {
  const { timeZone, now } = input;
  const slots: Slot[] = [];
  const add = (at: Date, note: string) => {
    if (slots.some((s) => s.at === at.toISOString())) return;
    slots.push({ at: at.toISOString(), label: slotLabel(at, timeZone, now), note });
  };
  if (input.ideaSlot) add(nextOccurrence(input.ideaSlot, timeZone, now), "suggested for this idea");
  input.bestHours.slice(0, 3).forEach((hour, i) => {
    add(nextOccurrence({ hour }, timeZone, now), RANK[i]);
  });
  return slots.slice(0, 4);
}

/** A `datetime-local` value ("2026-10-22T19:00") for an instant, in the profile's timezone. */
export function toLocalInput(at: Date, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** The instant a `datetime-local` value means in the profile's timezone, or null if it's malformed. */
export function fromLocalInput(value: string, timeZone: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return zonedTimeToUtc({ year, month, day, hour, minute }, timeZone);
}
