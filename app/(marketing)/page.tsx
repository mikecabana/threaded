import { Hero, type HeroSample } from "@/components/marketing/hero";
import { GoalCards, HowItWorks, Pricing } from "@/components/marketing/sections";
import { FORMAT_LABELS } from "@/lib/analysis/formats";
import { DEMO_PERSONAS } from "@/lib/demo/personas";
import { GOALS, type Goal } from "@/lib/goals";

// The hero is illustrated with the "creator" demo persona's real sample copy.
const persona = DEMO_PERSONAS.creator;

const samples = Object.fromEntries(
  GOALS.map((goal) => {
    const s = persona.suggestions[goal][0];
    return [goal, { text: s.text, rationale: s.rationale, goalFit: s.goalFit, format: FORMAT_LABELS[s.format] }];
  }),
) as Record<Goal, HeroSample>;

export default function LandingPage() {
  return (
    <>
      <Hero
        author={{ ...persona.profile, avatarHue: persona.avatarHue }}
        topPost={{
          text: persona.posts[7].text,
          insights: { views: 2064, likes: 131, replies: 49, reposts: 17, quotes: 11, shares: 6 },
        }}
        samples={samples}
      />
      <HowItWorks />
      <GoalCards />
      <Pricing />
    </>
  );
}
