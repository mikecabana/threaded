import { FORMAT_LABELS } from "@/lib/analysis/formats";
import { GOAL_META } from "@/lib/goals";
import type { GenerationContext } from "./context";
import { PLAYBOOKS, SPICE_GUIDANCE } from "./playbooks";
import type { GenerateRequest } from "./schemas";

// Versioned so every stored generation records which prompt produced it.
export const PROMPT_VERSION = "generate.v1";

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function buildInstructions(request: GenerateRequest): string {
  const playbook = PLAYBOOKS[request.goal];
  return [
    "You are a ghostwriter for one Threads account. You write posts that sound exactly like the author and serve one growth goal.",
    "",
    `Goal: ${GOAL_META[request.goal].label}. ${playbook.objective}`,
    "",
    "Levers that work for this goal:",
    ...playbook.levers.map((l) => `- ${l}`),
    "",
    "Avoid:",
    ...playbook.avoid.map((a) => `- ${a}`),
    "- Hashtags (Threads uses a single topic tag, which is added separately)",
    "- Anything that sounds like generic AI writing: 'unlock', 'game-changer', 'delve', em-dash pile-ups, 'Here's the thing'",
    "- Repeating or lightly rewording any of the author's existing posts",
    "- Inventing facts, numbers or experiences that would be dishonest for the author to post",
    "",
    `Tone: ${SPICE_GUIDANCE[request.spice]}`,
    "",
    "Rules:",
    "- Match the author's voice: length, casing, emoji habits, line breaks and vocabulary.",
    "- Every post must be under 450 characters (emoji count as several characters).",
    "- Each idea must be meaningfully different from the others.",
    "- In `rationale`, cite the author's own numbers from the context when they support the idea. Never make up numbers.",
    "- `goalFit` is your honest 0–100 estimate for this author, not a compliment.",
    "- `bestSlot` should use the author's best hours when known.",
  ].join("\n");
}

export function buildPrompt(request: GenerateRequest, context: GenerationContext): string {
  const { profile, voice } = context;
  const lines: string[] = [
    `Author: ${profile.name} (@${profile.username})`,
    profile.biography ? `Bio: ${profile.biography}` : "",
    "",
  ];

  if (voice.posts > 0) {
    lines.push(
      `Voice, from ${voice.posts} recent posts: typical length ${voice.medianLength} characters; ` +
        `${pct(voice.emojiShare)} use emoji; ${pct(voice.questionShare)} ask a question; ` +
        `${pct(voice.lowercaseShare)} start in lowercase; ${pct(voice.lineBreakShare)} use line breaks.`,
      "",
    );
  } else {
    lines.push("This author hasn't posted yet. Infer their voice and topics from the bio, and keep it natural.", "");
  }

  if (context.insights.length) lines.push("What the data says:", ...context.insights.map((i) => `- ${i}`), "");
  if (context.bestHours.length)
    lines.push(`Best hours to post (author's timezone): ${context.bestHours.join(", ")}.`, "");

  if (context.exemplars.length) {
    lines.push(`Their best posts for ${GOAL_META[request.goal].label.toLowerCase()} (learn the voice and what works):`);
    for (const [i, e] of context.exemplars.entries()) lines.push(`${i + 1}. """${e.text}""" (${e.summary})`);
    lines.push("");
  }
  if (context.weakest.length) {
    lines.push("Their weakest posts for this goal (patterns to avoid):");
    for (const text of context.weakest) lines.push(`- """${text}"""`);
    lines.push("");
  }
  if (context.recent.length) {
    lines.push("Recent posts (do not repeat these):");
    for (const text of context.recent) lines.push(`- """${text}"""`);
    lines.push("");
  }

  lines.push(
    `Write ${request.count} new post ideas.`,
    request.topic ? `Topic: ${request.topic}.` : "Topic: whatever fits the author's niche best.",
    request.format === "any"
      ? "Mix formats where it helps the goal."
      : `Format: ${FORMAT_LABELS[request.format]} for every idea.`,
  );
  return lines.filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");
}
