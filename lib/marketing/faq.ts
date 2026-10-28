import { BYOK_PLATFORM_FEE_USD, CREDIT_PACKS, creditsToUsd, TRIAL_CREDITS } from "@/lib/pricing";

// The landing page's questions. The same text feeds the FAQ section and its
// structured data (components/marketing/structured-data.tsx), which search
// engines expect to match what the page shows.

export interface Faq {
  question: string;
  answer: string;
}

const packs = CREDIT_PACKS.map((p) => `$${p.usd}`);

export const FAQS: Faq[] = [
  {
    question: "Is Threaded made by Meta or Threads?",
    answer:
      "No. Threaded is an independent app built on the official Threads API. You sign in with your Threads account, and you can remove its access from your Threads settings at any time.",
  },
  {
    question: "Will Threaded post without asking me?",
    answer:
      "Never. Nothing goes out unless you press Post or schedule a post yourself, and scheduled posts can be moved or cancelled from the Queue until they're published.",
  },
  {
    question: "What does Threaded read from my account?",
    answer:
      "Your profile, your posts and their insights: views, likes, replies, reposts, quotes, shares and follower counts. That's how it learns what your audience rewards. We don't sell your data or use your posts to train AI models.",
  },
  {
    question: "How does it know what works for me?",
    answer:
      "It labels each of your posts by format and topic, compares how they did against your own typical post, and sums it up as your Profile DNA: your voice, best formats, topics and hours, each backed by your numbers. Every idea is aimed at the goal you pick: more followers, views or engagement.",
  },
  {
    question: "Does Studio know what's happening this week?",
    answer:
      "Yes. When your topic names something specific, like a new tool or this week's news, Studio checks the web before writing and shows you its sources, so the ideas are about the real thing.",
  },
  {
    question: "How much does it cost?",
    answer: `You start with $${creditsToUsd(TRIAL_CREDITS).toFixed(0)} of free credits, and every batch shows its price before you run it; a batch of ideas usually costs a few cents. Top up with ${packs.slice(0, -1).join(", ")} or ${packs.at(-1)} packs (the bigger ones come with bonus credits), and credits never expire. Or bring your own Vercel AI Gateway key for a $${BYOK_PLATFORM_FEE_USD} monthly platform fee.`,
  },
  {
    question: "Which AI models write the ideas?",
    answer:
      "A short list of models we've tested on Threads posts, such as Anthropic's Claude, each priced per use. You choose the model for each batch, or use any model your own AI Gateway key offers.",
  },
  {
    question: "Can I try it before connecting my account?",
    answer:
      "Yes. The demo opens a sample account with realistic data, so you can explore Insights, Studio and the Queue for free, without signing in.",
  },
];
