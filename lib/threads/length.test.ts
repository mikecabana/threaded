import { describe, expect, it } from "vitest";
import { fitsThreads, threadsLength } from "./length";

describe("threadsLength", () => {
  it("counts plain text by character", () => {
    expect(threadsLength("hello")).toBe(5);
    expect(threadsLength("café")).toBe(4);
  });

  it("counts emoji by UTF-8 bytes", () => {
    expect(threadsLength("hi 👋")).toBe(3 + 4);
    // Skin tone modifier: two 4-byte code points.
    expect(threadsLength("👍🏽")).toBe(8);
    // ZWJ family: three emoji (4 bytes each) + two zero-width joiners (3 bytes each).
    expect(threadsLength("👩‍👩‍👧")).toBe(18);
  });

  it("enforces the 500 limit", () => {
    expect(fitsThreads("a".repeat(500))).toBe(true);
    expect(fitsThreads("a".repeat(501))).toBe(false);
    expect(fitsThreads(`${"a".repeat(497)}👋`)).toBe(false);
  });
});
