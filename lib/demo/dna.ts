import { voiceStats } from "@/lib/ai/context";
import { assembleDna, type DnaOutput, type ProfileDna } from "@/lib/ai/dna-prompt";
import { type Fact, performanceFacts, subjectPhrase, topicStats } from "@/lib/analysis/facts";
import type { PostWithInsights } from "@/lib/threads/types";
import { demoFeatures } from "./generate";
import type { DemoPersona, DemoPersonaId } from "./personas";

// The demo personas' Profile DNA: the voice is hand-written, and the claims
// come from the same facts a real account's do, so every number is measured
// from the demo data like anywhere else.

type Voice = Pick<DnaOutput, "headline" | "descriptors" | "signaturePhrases" | "habits" | "guide">;

const VOICES: Record<DemoPersonaId, Voice> = {
  creator: {
    headline: "You're at your best when you share the real numbers, plainly.",
    descriptors: ["candid", "plain-spoken", "builder's humour", "curious"],
    signaturePhrases: ["Tidy"],
    habits: [
      "Writes in full sentences with sentence case",
      "Uses line breaks and bullets for lists",
      "Skips emoji almost entirely",
      "Keeps most posts around two sentences",
    ],
    guide: [
      "Lead with the result or the number, then the lesson.",
      "Name the product, Tidy, when it's the real example.",
      "Ask questions other builders can answer from experience.",
      "Self-deprecating, never cynical.",
    ],
  },
  expert: {
    headline: "You're at your best giving runners one clear rule they can use tomorrow.",
    descriptors: ["warm", "direct", "evidence-minded", "encouraging"],
    signaturePhrases: ["Runners:"],
    habits: [
      "Opens with the rule, then the reason",
      "Numbered lists for plans and checklists",
      "Shares her own race stories, briefly",
      "Rare emoji; never hashtags",
    ],
    guide: [
      "Give one specific, safe instruction per post.",
      "Speak to beginners without talking down.",
      "Back claims with how the body actually works.",
      "End questions with your own answer first.",
    ],
  },
  brand: {
    headline: "You're at your best opinionated about coffee and generous with the how-to.",
    descriptors: ["opinionated", "playful", "knowledgeable", "neighbourly"],
    signaturePhrases: ["pour-over"],
    habits: [
      "Short, punchy sentences",
      "Recipes as bullet lists with exact numbers",
      'Speaks as "we", the roastery team',
      "Light jokes, no emoji pile-ups",
    ],
    guide: [
      "Share exact numbers: grams, degrees, seconds.",
      "Take a side on brewing debates, kindly.",
      "Credit the farms and co-ops by name.",
      "Invite people to settle a question.",
    ],
  },
};

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

function claimFor(fact: Fact, rewarded: boolean): string {
  // The fact underneath spells out the details ("140 characters or less").
  const subject = subjectPhrase(fact.subject).replace(/ \(.*\)$/, "");
  return rewarded
    ? `Your audience shows up for ${lower(subject)}.`
    : `${subject} land softer than the rest of your posts.`;
}

export function demoDna(persona: DemoPersona, data: { posts: PostWithInsights[] }, now: Date): ProfileDna {
  const features = demoFeatures(persona);
  const facts = performanceFacts(data.posts, features, now);
  const topics = topicStats(data.posts, features, now);
  const output: DnaOutput = {
    ...VOICES[persona.id],
    rewards: facts
      .filter((f) => f.multiplier > 1)
      .slice(0, 3)
      .map((f) => ({ fact: f.id, claim: claimFor(f, true) })),
    blindSpots: facts
      .filter((f) => f.multiplier < 1)
      .slice(0, 1)
      .map((f) => ({ fact: f.id, claim: claimFor(f, false) })),
    coreTopics: topics.slice(0, 3).map((t) => t.name),
  };
  return assembleDna({ output, facts, topics, stats: voiceStats(data.posts), posts: data.posts });
}
