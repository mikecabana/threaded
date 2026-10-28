import { z } from "zod";
import { POST_FORMATS } from "@/lib/analysis/formats";
import { GOALS } from "@/lib/goals";

// Shared by the generate route (structured output) and Studio (streamed
// partial objects). Keep the schema simple: providers ignore most numeric and
// length constraints, so those are enforced in post-processing instead.

export const suggestionSchema = z.object({
  text: z.string().describe("The post exactly as it should be published. Plain text, at most 500 characters."),
  parts: z
    .array(z.string())
    .describe("For a thread, the posts after the first, in order, each as it should be published. Otherwise empty."),
  format: z.enum(POST_FORMATS),
  hook: z.string().describe("One sentence: why the first line stops the scroll."),
  rationale: z
    .string()
    .describe("One or two sentences on why this serves the goal, citing the author's own numbers when available."),
  goalFit: z.number().describe("0–100: how well this serves the goal for this specific author."),
  bestSlot: z
    .object({
      weekday: z.number().describe("0 = Sunday … 6 = Saturday, in the author's timezone."),
      hour: z.number().describe("0–23, in the author's timezone."),
    })
    .describe("When to post it, based on the author's best hours."),
});

export const suggestionBatchSchema = z.object({ suggestions: z.array(suggestionSchema) });

export type Suggestion = z.infer<typeof suggestionSchema>;
export type SuggestionBatch = z.infer<typeof suggestionBatchSchema>;

export const SPICE_LEVELS = ["mild", "bold", "spicy"] as const;
export type SpiceLevel = (typeof SPICE_LEVELS)[number];

/** One post per idea, or a thread: an opening post and the parts that reply to it. */
export const IDEA_SHAPES = ["post", "thread"] as const;
export type IdeaShape = (typeof IDEA_SHAPES)[number];
/** What Studio sends to /api/generate. */
export const generateRequestSchema = z.object({
  goal: z.enum(GOALS),
  topic: z.string().trim().max(120).optional(),
  spice: z.enum(SPICE_LEVELS).default("bold"),
  shape: z.enum(IDEA_SHAPES).default("post"),
  format: z.enum([...POST_FORMATS, "any"]).default("any"),
  count: z.number().int().min(3).max(5).default(3),
  modelId: z.string().max(120).optional(),
});

export type GenerateRequest = z.infer<typeof generateRequestSchema>;
