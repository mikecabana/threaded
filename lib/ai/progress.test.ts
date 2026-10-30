import { describe, expect, it } from "vitest";
import { type BatchContext, contextHeader, type ProgressInput, progressSteps, readContextHeader } from "./progress";

const context: BatchContext = { posts: 8, dna: true, research: null };

const base: ProgressInput = {
  phase: "streaming",
  topic: null,
  threadsSearch: true,
  responded: false,
  context: null,
  shape: "post",
  count: 3,
  streamed: 0,
  wrote: null,
  checks: true,
  outcome: null,
};

const lines = (input: Partial<ProgressInput>) =>
  progressSteps({ ...base, ...input }).map((step) => `${step.state === "active" ? "…" : "✓"} ${step.text}`);

describe("the context header", () => {
  it("round-trips the counts", () => {
    const withResearch = { ...context, research: { threads: 2, web: 3 } };
    expect(readContextHeader(contextHeader(withResearch))).toEqual(withResearch);
  });

  it("reads a missing or malformed header as nothing", () => {
    expect(readContextHeader(null)).toBeNull();
    expect(readContextHeader("not json")).toBeNull();
    expect(readContextHeader(JSON.stringify({ posts: -1, dna: true, research: null }))).toBeNull();
    expect(readContextHeader(JSON.stringify({ posts: 3 }))).toBeNull();
  });
});

describe("Studio's progress steps", () => {
  it("reads the posts first, then writes, then checks and saves", () => {
    expect(lines({})).toEqual(["… Reading your best posts…"]);
    expect(lines({ responded: true, context })).toEqual([
      "✓ Read your 8 best posts and your Profile DNA",
      "… Writing idea 1 of 3…",
    ]);
    expect(lines({ responded: true, context, streamed: 2 })).toContain("… Writing idea 2 of 3…");
    expect(lines({ phase: "finalizing", responded: true, context, streamed: 3, wrote: 3 })).toEqual([
      "✓ Read your 8 best posts and your Profile DNA",
      "✓ Wrote 3 ideas",
      "… Checking them against your posts and voice settings…",
    ]);
    expect(
      lines({ phase: "done", responded: true, context, streamed: 3, wrote: 3, outcome: { kept: 3, dropped: 0 } }),
    ).toEqual(["✓ Read your 8 best posts and your Profile DNA", "✓ Wrote 3 ideas", "✓ Checked and saved all 3"]);
  });

  it("looks the topic up before writing, and says what it read", () => {
    const topic = "php2shell";
    expect(lines({ topic })).toEqual(["… Looking up “php2shell” on Threads and the web…"]);
    expect(lines({ topic, threadsSearch: false })).toEqual(["… Checking the web for “php2shell”…"]);
    const read = { ...context, research: { threads: 2, web: 1 } };
    expect(lines({ topic, responded: true, context: read })).toEqual([
      "✓ Read your 8 best posts and your Profile DNA",
      "✓ Read 2 posts on Threads and 1 web page about “php2shell”",
      "… Writing idea 1 of 3…",
    ]);
    expect(lines({ topic, responded: true, context: { ...context, research: { threads: 0, web: 0 } } })[1]).toBe(
      "✓ Looked up “php2shell”: nothing recent to add",
    );
    expect(lines({ topic, responded: true, context })[1]).toBe("✓ Couldn't look up “php2shell” this time");
  });

  it("counts threads and what the check left out", () => {
    const done = { phase: "done" as const, responded: true, context, shape: "thread" as const, streamed: 3, wrote: 3 };
    expect(lines({ ...done, outcome: { kept: 2, dropped: 1 } }).slice(1)).toEqual([
      "✓ Wrote 3 threads",
      "✓ Saved 2, left out 1",
    ]);
    expect(lines({ ...done, outcome: { kept: 0, dropped: 3 } }).at(-1)).toBe("✓ Left out all 3");
    // Extras past the batch size aren't counted: the check keeps no more than were asked for.
    expect(lines({ ...done, streamed: 5, wrote: 5, outcome: { kept: 3, dropped: 0 } }).slice(1)).toEqual([
      "✓ Wrote 3 threads",
      "✓ Checked and saved all 3",
    ]);
    expect(lines({ ...done, wrote: 1, outcome: { kept: 1, dropped: 0 } }).slice(1)).toEqual([
      "✓ Wrote 1 thread",
      "✓ Checked and saved it",
    ]);
  });

  it("speaks plainly about accounts with few posts, and the demo", () => {
    expect(lines({ responded: true, context: { posts: 1, dna: false, research: null } })[0]).toBe(
      "✓ Read your best post",
    );
    expect(lines({ responded: true, context: { posts: 0, dna: false, research: null } })[0]).toBe(
      "✓ Read your profile",
    );
    // The demo sends no counts, and its ideas aren't checked or saved.
    expect(lines({ phase: "done", responded: true, checks: false, streamed: 3, wrote: 3 })).toEqual([
      "✓ Read your best posts",
      "✓ Wrote 3 ideas",
    ]);
  });

  it("leaves off the step that was running when the batch failed", () => {
    expect(lines({ phase: "error" })).toEqual([]);
    expect(lines({ phase: "error", responded: true, context, streamed: 1 })).toEqual([
      "✓ Read your 8 best posts and your Profile DNA",
    ]);
    expect(lines({ phase: "error", responded: true, context, streamed: 3, wrote: 3 })).toEqual([
      "✓ Read your 8 best posts and your Profile DNA",
      "✓ Wrote 3 ideas",
    ]);
  });
});
