export const POST_FORMATS = ["hot_take", "question", "story", "list", "tip", "observation", "series"] as const;

export type PostFormat = (typeof POST_FORMATS)[number];

export const FORMAT_LABELS: Record<PostFormat, string> = {
  hot_take: "Hot take",
  question: "Question",
  story: "Story",
  list: "List",
  tip: "Tip",
  observation: "Observation",
  series: "Series",
};

/** How a post opens: what's meant to stop the scroll. */
export const HOOK_TYPES = [
  "question",
  "bold_claim",
  "number",
  "story_opener",
  "how_to",
  "confession",
  "callout",
  "observation",
] as const;

export type HookType = (typeof HOOK_TYPES)[number];

export const HOOK_LABELS: Record<HookType, string> = {
  question: "Opens with a question",
  bold_claim: "Opens with a bold claim",
  number: "Opens with a number",
  story_opener: "Opens mid-story",
  how_to: "Opens with a how-to",
  confession: "Opens with a confession",
  callout: "Opens by calling out the reader",
  observation: "Opens with an observation",
};

export const TONES = [
  "playful",
  "earnest",
  "contrarian",
  "analytical",
  "vulnerable",
  "celebratory",
  "frustrated",
  "neutral",
] as const;

export type Tone = (typeof TONES)[number];

/** What the classifier says about one post (docs/PLAN.md §4c). */
export interface PostFeatures {
  format: PostFormat;
  /** Short lowercase label, e.g. "pricing"; reused across the author's posts. */
  topic: string | null;
  hookType: HookType | null;
  tone: Tone | null;
}
