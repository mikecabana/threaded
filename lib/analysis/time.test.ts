import { describe, expect, it } from "vitest";
import { hourLabel, zonedParts, zonedTimeToUtc } from "./time";

describe("time zones", () => {
  it("reads wall-clock parts in a zone", () => {
    // 2026-07-01 12:00 UTC is 08:00 in Toronto (EDT, UTC-4), a Wednesday.
    const parts = zonedParts(new Date("2026-07-01T12:00:00Z"), "America/Toronto");
    expect(parts).toMatchObject({ year: 2026, month: 7, day: 1, hour: 8, minute: 0, weekday: 3 });
  });

  it("converts wall-clock time back to UTC across DST", () => {
    const summer = zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 8, minute: 30 }, "America/Toronto");
    expect(summer.toISOString()).toBe("2026-07-01T12:30:00.000Z");
    const winter = zonedTimeToUtc({ year: 2026, month: 12, day: 1, hour: 8, minute: 30 }, "America/Toronto");
    expect(winter.toISOString()).toBe("2026-12-01T13:30:00.000Z");
    const london = zonedTimeToUtc({ year: 2026, month: 7, day: 1, hour: 7, minute: 0 }, "Europe/London");
    expect(london.toISOString()).toBe("2026-07-01T06:00:00.000Z");
  });

  it("labels hours on a 12-hour clock", () => {
    expect(hourLabel(0)).toBe("12 AM");
    expect(hourLabel(12)).toBe("12 PM");
    expect(hourLabel(19)).toBe("7 PM");
    expect(hourLabel(24)).toBe("12 AM");
  });
});
