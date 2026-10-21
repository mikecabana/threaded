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
