import type { Goal } from "@/lib/goals";

// The fixed strategy behind each goal (docs/PLAN.md §4b): what it optimizes
// and which levers the writer should pull.

export interface Playbook {
  objective: string;
  levers: string[];
  avoid: string[];
}

export const PLAYBOOKS: Record<Goal, Playbook> = {
  followers: {
    objective:
      "Grow followers. Write posts that people outside the author's audience repost and share, and that make the author's profile worth following: a clear niche, real expertise, and a reason to come back.",
    levers: [
      "Value-dense posts people save or repost: lists, frameworks, hard-won lessons with specifics",
      "Series and recurring formats ('part 1 of 5', 'every Friday') that reward following",
      "Consistency with the author's core topics, so new visitors know what they'd get",
      "Occasional soft calls to follow that feel earned, never begging",
    ],
    avoid: ["Inside jokes that only existing followers get", "Engagement bait with no substance"],
  },
  views: {
    objective:
      "Maximize views per post. Write posts with a scroll-stopping first line and broad appeal, likely to be quoted and pushed beyond the author's followers.",
    levers: [
      "A first line that creates tension, surprise or a strong opinion",
      "Short, quotable lines; most top-view posts fit in a sentence or two",
      "Timely or universal angles on the author's topics",
      "Clear takes that people will quote to agree or disagree",
    ],
    avoid: ["Slow wind-ups before the point", "Niche jargon that loses a broad audience"],
  },
  engagement: {
    objective:
      "Maximize engagement, replies above all. Write conversation starters the author's audience can't resist answering.",
    levers: [
      "Open, specific questions that are easy and flattering to answer",
      "Either/or prompts and mild, good-natured hot takes",
      "Answering your own question first to model the reply",
      "Personal stories that end with an invitation to share",
    ],
    avoid: ["Yes/no questions with nothing to add", "Asking for likes or reposts directly"],
  },
};

export const SPICE_GUIDANCE = {
  mild: "Keep the tone warm and safe. No hot takes.",
  bold: "Be confident and opinionated where it helps, but stay kind.",
  spicy: "Take strong, contrarian positions the author could defend. Provocative, never cruel or offensive.",
} as const;
