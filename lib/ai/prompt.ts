import { FORMAT_LABELS } from "@/lib/analysis/formats";
import { GOAL_META } from "@/lib/goals";
import type { GenerationContext } from "./context";
import { PLAYBOOKS, SPICE_GUIDANCE } from "./playbooks";
import type { GenerateRequest } from "./schemas";

// Versioned so every stored generation records which prompt produced it.
// v2: the Profile DNA voice guide, labelled and topic-aware exemplars, and facts for the goal.
// v3: drafts from Threaded that beat the author's usual are pinned among the exemplars.
export const PROMPT_VERSION = "generate.v3";

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
    "- Match the author's voice: length, casing, emoji habits, line breaks and vocabulary. When a voice guide is given, follow it.",
    "- Use the author's signature phrases sparingly: at most one idea should lean on one.",
    "- Every post must be under 450 characters (emoji count as several characters).",
    "- Each idea must be meaningfully different from the others.",
    "- In `rationale`, cite the author's own numbers from the context when they support the idea. Never make up numbers.",
    "- `goalFit` is your honest 0–100 estimate for this author, not a compliment.",
    "- `bestSlot` should use the author's best hours when known.",
  ].join("\n");
}

function topicNote({ matchedTopic, onTopicExemplars }: GenerationContext): string {
  if (!matchedTopic) return "";
  return onTopicExemplars > 0
    ? ` They've written about ${matchedTopic} before; the first examples are their best posts on it.`
    : ` They've written about ${matchedTopic} before, though not among their best posts for this goal.`;
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

  const { dna } = context;
  if (dna) {
    lines.push(`Voice guide, learned from ${dna.postsAnalyzed} of their posts:`);
    if (dna.headline) lines.push(`- ${dna.headline}`);
    if (dna.descriptors.length) lines.push(`- In a few words: ${dna.descriptors.join(", ")}.`);
    lines.push(...dna.habits.map((h) => `- ${h}`), ...dna.guide.map((g) => `- ${g}`));
    if (dna.signaturePhrases.length) {
      lines.push(`- Phrases they really use: ${dna.signaturePhrases.map((p) => `"${p}"`).join(", ")}.`);
    }
    lines.push("");
    if (dna.rewards.length) lines.push("What their audience rewards:", ...dna.rewards.map((r) => `- ${r}`), "");
    if (dna.blindSpots.length) {
      lines.push("Blind spots (avoid these, or find a better version):", ...dna.blindSpots.map((b) => `- ${b}`), "");
    }
  }

  if (context.insights.length) lines.push("What the data says:", ...context.insights.map((i) => `- ${i}`), "");
  if (context.bestHours.length)
    lines.push(`Best hours to post (author's timezone): ${context.bestHours.join(", ")}.`, "");

  if (context.exemplars.length) {
    lines.push(`Their best posts for ${GOAL_META[request.goal].label.toLowerCase()} (learn the voice and what works):`);
    for (const [i, e] of context.exemplars.entries()) lines.push(`${i + 1}. """${e.text}""" (${e.summary})`);
    if (context.exemplars.some((e) => e.summary.includes("drafted in Threaded"))) {
      lines.push("The ones drafted in Threaded beat their usual: build on what made them work, without copying them.");
    }
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
    request.topic ? `Topic: ${request.topic}.${topicNote(context)}` : "Topic: whatever fits the author's niche best.",
    request.format === "any"
      ? "Mix formats where it helps the goal."
      : `Format: ${FORMAT_LABELS[request.format]} for every idea.`,
  );
  return lines.filter((line, i, all) => !(line === "" && all[i - 1] === "")).join("\n");
}
