import type { PostFormat } from "@/lib/analysis/formats";
import type { Goal } from "@/lib/goals";
import type { ThreadsMediaType, ThreadsProfile } from "@/lib/threads/types";

// Fictional demo accounts. Post text is hand-written so the demo reads like a
// real profile; metrics are generated from these seeds in ./generate.ts.

export const DEMO_PERSONA_IDS = ["creator", "expert", "brand"] as const;
export type DemoPersonaId = (typeof DEMO_PERSONA_IDS)[number];

export function isDemoPersonaId(value: unknown): value is DemoPersonaId {
  return typeof value === "string" && (DEMO_PERSONA_IDS as readonly string[]).includes(value);
}

export interface DemoPostSeed {
  text: string;
  format: PostFormat;
  topic: string;
  mediaType?: ThreadsMediaType;
  topicTag?: string;
}

export interface DemoSuggestion {
  text: string;
  /** For a thread, the posts after the first (account ideas only). */
  parts?: string[];
  format: PostFormat;
  hook: string;
  rationale: string;
  goalFit: number;
  /** In the persona's timezone. weekday: 0 = Sunday. */
  bestSlot: { weekday: number; hour: number };
}

export interface DemoPersona {
  id: DemoPersonaId;
  label: string;
  profile: ThreadsProfile;
  timezone: string;
  avatarHue: number;
  defaultGoal: Goal;
  followersStart: number;
  /** Share of followers a typical post reaches. */
  reach: number;
  /** Baseline per-view rates before format multipliers. */
  rates: { like: number; reply: number; repost: number; quote: number; share: number };
  /** Hours (local) this account usually posts at. */
  postingHours: number[];
  /** Hours (local) its audience is most active. */
  peakHours: number[];
  dailyFollowerGrowth: number;
  credits: number;
  posts: DemoPostSeed[];
  suggestions: Record<Goal, DemoSuggestion[]>;
  upNext: { text: string; weekday: number; hour: number };
}

const creator: DemoPersona = {
  id: "creator",
  label: "Indie hacker",
  profile: {
    id: "demo-creator",
    username: "maya.builds",
    name: "Maya Chen",
    biography: "Building Tidy, a calm budgeting app. Indie hacker. Sharing the real numbers.",
    profilePictureUrl: null,
    isVerified: false,
  },
  timezone: "America/Toronto",
  avatarHue: 20,
  defaultGoal: "engagement",
  followersStart: 2050,
  reach: 0.55,
  rates: { like: 0.045, reply: 0.009, repost: 0.004, quote: 0.002, share: 0.003 },
  postingHours: [8, 9, 12, 17, 19, 21],
  peakHours: [9, 19],
  dailyFollowerGrowth: 2.5,
  credits: 482,
  posts: [
    {
      text: "What's the first thing you'd cut from your app if you had to ship in 7 days? Asking for a friend (the friend is me, launch is Friday).",
      format: "question",
      topic: "Building",
    },
    {
      text: "Unpopular opinion: your $9/mo plan is why you have churn, not your onboarding. People don't value what they barely pay for.",
      format: "hot_take",
      topic: "Pricing",
    },
    {
      text: "Tidy hit $1,000 MRR this morning. 14 months, 3 rewrites, 1 near-quit in March. The thing that finally worked wasn't a feature. It was emailing every churned user and actually listening.",
      format: "story",
      topic: "Building",
      topicTag: "Indie Hackers",
    },
    {
      text: "Things that got Tidy its first 100 users:\n\n1. Replying to every budgeting thread for 6 weeks\n2. A free spreadsheet template\n3. One Reddit post that blew up\n4. Not a single ad",
      format: "list",
      topic: "Marketing",
    },
    {
      text: "Small UX trick: show the empty state you want people to reach, not a blank screen. Our 'all caught up' illustration lifted day-2 retention more than any feature this year.",
      format: "tip",
      topic: "Design",
    },
    {
      text: "Noticing I ship more on the weeks I take Friday off. Rest isn't the opposite of work, it's part of it.",
      format: "observation",
      topic: "Burnout",
    },
    {
      text: "Indie hackers: do you build in public or in private? I've done both and I still can't decide which made me more productive.",
      format: "question",
      topic: "Building",
      topicTag: "Indie Hackers",
    },
    {
      text: "'Build it and they will come' is dead. 'Build it while they watch' is the whole game now.",
      format: "hot_take",
      topic: "Marketing",
    },
    {
      text: "Shipped dark mode at 1am. Woke up to 40 replies. 39 said thanks. 1 said the shade of gray was 'emotionally exhausting'. Changing the shade of gray.",
      format: "story",
      topic: "Building",
      mediaType: "IMAGE",
    },
    {
      text: "Pricing page changes that moved our conversion:\n\n• Annual toggle on by default\n• One plan, not three\n• A real screenshot instead of a mockup\n• 'Cancel anytime' right under the button",
      format: "list",
      topic: "Pricing",
    },
    {
      text: "Which one: a beautiful app that's a bit slow, or an ugly app that's instant? You can only pick one.",
      format: "question",
      topic: "Design",
    },
    {
      text: "If your launch post doesn't show what you built in the first line of sight, half the people scrolling never find out.",
      format: "tip",
      topic: "Marketing",
    },
    {
      text: "Every feature request is really a sentence that starts with 'I'm frustrated because…'. Find the sentence, not the feature.",
      format: "observation",
      topic: "Building",
    },
    {
      text: "Your side project doesn't need a landing page, a logo or a domain. It needs 10 people who'd be sad if it disappeared.",
      format: "hot_take",
      topic: "Building",
    },
    {
      text: "How do you all switch off work brain at night? Mine keeps redesigning the settings screen at 2am.",
      format: "question",
      topic: "Burnout",
    },
    {
      text: "A user sent me a voice memo about how Tidy helped her pay off a credit card. I've listened to it four times. This is why I build.",
      format: "story",
      topic: "Marketing",
    },
    {
      text: "Raise your prices before you think you're ready. Tell existing users they're grandfathered. Nobody leaves, and new users don't blink.",
      format: "tip",
      topic: "Pricing",
    },
    {
      text: "My solo dev stack in 2026:\n\n• Next.js + Postgres\n• One server I'm scared to touch\n• Stripe\n• A notes app full of half ideas",
      format: "list",
      topic: "Building",
    },
    {
      text: "What's a product you discovered on Threads and still use? Looking for good examples of how people launch here.",
      format: "question",
      topic: "Marketing",
    },
    {
      text: "The best onboarding I've seen this year asked me one question and then got out of the way.",
      format: "observation",
      topic: "Design",
    },
  ],
  suggestions: {
    followers: [
      {
        text: "Building Tidy in public, part 1 of 10: the 3 decisions I'd make differently if I started today. Part 2 (pricing) drops Thursday.",
        format: "series",
        hook: "Opens a series, so following is the only way to catch part 2.",
        rationale:
          "Your building-in-public stories get about 2× your median reposts. A series turns that reach into follows.",
        goalFit: 88,
        bestSlot: { weekday: 2, hour: 9 },
      },
      {
        text: "Every pricing experiment I ran on Tidy this year, with numbers:\n\n• $4 → $7/mo: churn flat, MRR +61%\n• Annual plan as default: +34% annual signups\n• Removed the free tier: signups −20%, revenue +18%",
        format: "list",
        hook: "Real numbers make it worth saving and sharing.",
        rationale: "Lists are your most reposted format, and pricing is the topic your audience saves most.",
        goalFit: 84,
        bestSlot: { weekday: 3, hour: 12 },
      },
      {
        text: "If you're an indie hacker with under 1,000 followers: reply thoughtfully to 10 bigger accounts in your niche every day for a month. It's how I got my first 2,000.",
        format: "tip",
        hook: "Speaks directly to the people most likely to follow you.",
        rationale: "Your follower jumps line up with practical marketing tips like this one.",
        goalFit: 79,
        bestSlot: { weekday: 4, hour: 19 },
      },
    ],
    views: [
      {
        text: "Hot take: most SaaS onboarding exists to make the founder feel productive, not the user.",
        format: "hot_take",
        hook: "A first line people want to quote, agree or not.",
        rationale: "Your hot takes average well above your median views, and quotes carry them past your followers.",
        goalFit: 90,
        bestSlot: { weekday: 2, hour: 9 },
      },
      {
        text: "Nobody cancels a subscription because of a missing feature. They cancel the week they stop opening the app.",
        format: "observation",
        hook: "Short, universal and true for every app.",
        rationale: "Your top posts by views are all under 140 characters.",
        goalFit: 85,
        bestSlot: { weekday: 1, hour: 19 },
      },
      {
        text: "Be honest: would you pay $5/month for an app that did one thing perfectly?",
        format: "question",
        hook: "A yes/no question anyone can answer in a second.",
        rationale: "Quick polls spread fast. Tuesday mornings are your best slot for views.",
        goalFit: 81,
        bestSlot: { weekday: 2, hour: 8 },
      },
    ],
    engagement: [
      {
        text: "What's one thing you stopped doing this year that made your work better? I stopped checking analytics before noon.",
        format: "question",
        hook: "Answers its own question, which makes replying easy.",
        rationale: "Your questions get roughly 3× the replies of your other posts.",
        goalFit: 92,
        bestSlot: { weekday: 3, hour: 19 },
      },
      {
        text: "Show me your messiest unfinished side project. I'll go first: a habit tracker with 2 users (me and my mom).",
        format: "question",
        hook: "Self-deprecating opener, low-stakes invitation.",
        rationale: "Posts where you poke fun at yourself get your highest like rate.",
        goalFit: 87,
        bestSlot: { weekday: 5, hour: 12 },
      },
      {
        text: "Agree or disagree: shipping something ugly next week beats shipping something perfect next quarter.",
        format: "hot_take",
        hook: "Agree/disagree framing gives people an easy way in.",
        rationale: "Your hot takes pull about twice your median replies.",
        goalFit: 83,
        bestSlot: { weekday: 1, hour: 9 },
      },
    ],
  },
  upNext: {
    text: "Tidy's 1-year launchiversary is Thursday. I'm sharing every number: revenue, churn, costs, the lot. Anything you want me to include?",
    weekday: 4,
    hour: 9,
  },
};

const expert: DemoPersona = {
  id: "expert",
  label: "Running coach",
  profile: {
    id: "demo-expert",
    username: "coachpriya.runs",
    name: "Priya Raman",
    biography: "Running coach · 2× Boston · Helping busy people run their first marathon without getting hurt.",
    profilePictureUrl: null,
    isVerified: true,
  },
  timezone: "Europe/London",
  avatarHue: 220,
  defaultGoal: "views",
  followersStart: 17_100,
  reach: 0.42,
  rates: { like: 0.038, reply: 0.006, repost: 0.005, quote: 0.0015, share: 0.006 },
  postingHours: [6, 7, 12, 18, 20],
  peakHours: [7, 20],
  dailyFollowerGrowth: 14,
  credits: 1240,
  posts: [
    {
      text: "The 5 runs every marathon plan needs:\n\n1. Easy run (most of your week)\n2. Long run\n3. Tempo\n4. Intervals\n5. Rest. Yes, it counts.",
      format: "list",
      topic: "Training",
      topicTag: "Marathon Training",
    },
    {
      text: "If your legs feel heavy for 3+ days, it's not a fitness problem. It's a sleep problem. Fix the 7 hours before you fix the plan.",
      format: "tip",
      topic: "Recovery",
    },
    {
      text: "Runners: what's the one workout you secretly skip every week? No judgment. (Mine is strides.)",
      format: "question",
      topic: "Training",
    },
    {
      text: "Most beginners don't need speed work. They need to run slower, more often, for longer. Boring works.",
      format: "hot_take",
      topic: "Training",
    },
    {
      text: "At mile 22 of my first marathon I sat on a curb and cried. A stranger handed me a gummy bear and said 'one more mile, then decide.' I've been saying that to athletes for 9 years.",
      format: "story",
      topic: "Race day",
    },
    {
      text: "What I eat the morning of a race:\n\n• White bagel + honey\n• Banana\n• Coffee (only if you trained with it)\n• Nothing new. Ever.",
      format: "list",
      topic: "Nutrition",
    },
    {
      text: "Easy pace test: if you can't say a full sentence without gasping, you're not running easy. Slow down. Your future self will thank you.",
      format: "tip",
      topic: "Training",
    },
    {
      text: "What made you start running? I'll go first: a breakup and a free pair of shoes.",
      format: "question",
      topic: "Mindset",
    },
    {
      text: "The athletes who improve fastest aren't the ones who train hardest. They're the ones who never miss two weeks in a row.",
      format: "observation",
      topic: "Mindset",
    },
    {
      text: "You don't need gels for a 10K. You need breakfast.",
      format: "hot_take",
      topic: "Nutrition",
    },
    {
      text: "Race-week checklist:\n\n☐ Cut mileage by 40%\n☐ Lay out your kit on Thursday\n☐ Test the bib pins\n☐ Plan your first 3 miles slower than goal pace\n☐ Sleep well two nights before (the night before rarely happens)",
      format: "list",
      topic: "Race day",
      topicTag: "Marathon Training",
    },
    {
      text: "Foam rolling won't fix a bad week of sleep, but a walk the day after a long run genuinely helps. 20 minutes, no watch.",
      format: "tip",
      topic: "Recovery",
    },
    {
      text: "One of my athletes, 52, ran her first half marathon on Sunday. 18 months ago she couldn't run to the end of her street. Consistency is a superpower.",
      format: "story",
      topic: "Training",
      mediaType: "IMAGE",
    },
    {
      text: "Headphones or no headphones on race day? This splits every running club I've ever coached.",
      format: "question",
      topic: "Race day",
    },
    {
      text: "Signs you're overtraining:\n\n1. Resting heart rate up 5+ bpm\n2. Easy runs feel hard\n3. You dread every session\n4. Sleep gets worse, not better",
      format: "list",
      topic: "Recovery",
    },
    {
      text: "Pace is a number. Showing up is a habit. Only one of them compounds.",
      format: "observation",
      topic: "Mindset",
    },
    {
      text: "Ice baths are overrated for most recreational runners. Sleep, food and an easy week will do more.",
      format: "hot_take",
      topic: "Recovery",
    },
    {
      text: "Practise your race-day fuel on long runs. Your stomach needs training too.",
      format: "tip",
      topic: "Nutrition",
    },
    {
      text: "What's your longest run ever? Reply with the distance and how you felt after 😅",
      format: "question",
      topic: "Training",
    },
    {
      text: "I DNF'd a marathon last spring. Felt like a failure for a week. Then I realised I'd learned more from that race than from any PR.",
      format: "story",
      topic: "Mindset",
    },
  ],
  suggestions: {
    followers: [
      {
        text: "Marathon in 16 weeks, a series. Week 1: why your first month should feel too easy. I'll post the next week every Monday.",
        format: "series",
        hook: "A weekly series is a reason to follow, not just to like.",
        rationale: "Your training lists get the most reposts in your niche. A series turns those reposts into follows.",
        goalFit: 89,
        bestSlot: { weekday: 1, hour: 7 },
      },
      {
        text: "Save this. My recovery rules after 9 years of coaching:\n\n1. Easy day after every hard day\n2. 7+ hours of sleep is training\n3. Walk the day after a long run\n4. Cut back every 4th week",
        format: "list",
        hook: "'Save this' plus a numbered list is built to be shared.",
        rationale: "Lists are your most-shared format by a wide margin.",
        goalFit: 85,
        bestSlot: { weekday: 0, hour: 20 },
      },
      {
        text: "New runners: if you follow one rule, make it this one. Never increase your weekly distance by more than 10%.",
        format: "tip",
        hook: "Names its audience in the first two words.",
        rationale: "Beginner tips bring in your newest followers. Your follower jumps line up with them.",
        goalFit: 80,
        bestSlot: { weekday: 3, hour: 18 },
      },
    ],
    views: [
      {
        text: "You don't need carbon-plated shoes to run a sub-4 marathon. You need 16 weeks of boring consistency.",
        format: "hot_take",
        hook: "Takes a side on gear, the topic everyone has an opinion on.",
        rationale: "Gear hot takes get your most views from people who don't follow you yet.",
        goalFit: 88,
        bestSlot: { weekday: 6, hour: 7 },
      },
      {
        text: "5 mistakes at every marathon start line:\n\n1. New shoes\n2. Going out too fast\n3. Skipping the toilet queue\n4. Not starting slower than goal pace\n5. Trying a gel for the first time",
        format: "list",
        hook: "Every runner recognises at least two of these.",
        rationale: "Race-day posts peak on Saturday mornings, your highest-view slot.",
        goalFit: 86,
        bestSlot: { weekday: 6, hour: 8 },
      },
      {
        text: "The hardest part of marathon training isn't mile 20. It's the Tuesday easy run when it's raining.",
        format: "observation",
        hook: "Relatable in one line.",
        rationale: "Short, relatable lines are your top posts by views.",
        goalFit: 82,
        bestSlot: { weekday: 2, hour: 7 },
      },
    ],
    engagement: [
      {
        text: "What's the worst running advice you've ever been given? I'll start: 'no pain, no gain.'",
        format: "question",
        hook: "Everyone has an answer, and you've modelled the reply.",
        rationale: "Your questions get close to 3× your median replies.",
        goalFit: 93,
        bestSlot: { weekday: 3, hour: 20 },
      },
      {
        text: "Morning runners vs. evening runners: which camp are you in, and why?",
        format: "question",
        hook: "Either/or questions take one second to answer.",
        rationale: "Either/or questions have the highest reply rate in your history.",
        goalFit: 86,
        bestSlot: { weekday: 1, hour: 20 },
      },
      {
        text: "One of my athletes just ran her first 10K at 61. She asked me to post this so her grandkids could see. Tell her congratulations 👇",
        format: "story",
        hook: "A clear, warm reason to reply.",
        rationale: "Athlete stories get your highest like rate. Asking for a reply turns likes into comments.",
        goalFit: 84,
        bestSlot: { weekday: 0, hour: 18 },
      },
    ],
  },
  upNext: {
    text: "Long run on Sunday? Here's the pacing rule that saved my athletes' legs this year: first third easy, middle third steady, last third whatever you have left.",
    weekday: 6,
    hour: 7,
  },
};

const brand: DemoPersona = {
  id: "brand",
  label: "Coffee brand",
  profile: {
    id: "demo-brand",
    username: "fernandfig.coffee",
    name: "Fern & Fig Coffee",
    biography: "Small-batch roaster in Portland. Single origins, honest prices, too many opinions about grind size.",
    profilePictureUrl: null,
    isVerified: true,
  },
  timezone: "America/Los_Angeles",
  avatarHue: 295,
  defaultGoal: "followers",
  followersStart: 49_800,
  reach: 0.3,
  rates: { like: 0.032, reply: 0.004, repost: 0.003, quote: 0.001, share: 0.004 },
  postingHours: [7, 8, 11, 15, 18],
  peakHours: [8, 15],
  dailyFollowerGrowth: 30,
  credits: 3050,
  posts: [
    {
      text: "This week's Ethiopia lot comes from a co-op of 400 farmers in Guji. We've bought from them for 6 years. Tasting notes: peach, black tea, a little bergamot. Their best harvest yet.",
      format: "story",
      topic: "Origins",
      mediaType: "IMAGE",
      topicTag: "Coffee",
    },
    {
      text: "Settle this for our team: do you rinse your paper filter before brewing? Half of us say it changes everything, half say it's a ritual.",
      format: "question",
      topic: "Brewing",
    },
    {
      text: "If your pour-over tastes sour, grind finer. Bitter? Grind coarser. That's 80% of troubleshooting.",
      format: "tip",
      topic: "Brewing",
    },
    {
      text: "Dark roast doesn't have more caffeine. It just tastes like it's trying harder.",
      format: "hot_take",
      topic: "Brewing",
    },
    {
      text: "Our cafe's pour-over recipe:\n\n• 20g coffee\n• 320g water at 94°C\n• 40g bloom, wait 40s\n• Pour to 320g by 2:30\n• Done by 3:30",
      format: "list",
      topic: "Brewing",
      topicTag: "Coffee",
    },
    {
      text: "6am roast day. The first batch always goes a little wrong. The second batch is the one we taste. The third is the one you get.",
      format: "story",
      topic: "Behind the scenes",
      mediaType: "IMAGE",
    },
    {
      text: "What's your go-to order when you're trying a new cafe? Ours is a cortado. Tells you everything.",
      format: "question",
      topic: "Community",
    },
    {
      text: "Coffee is a fruit. The more we treat it like one, the better it tastes.",
      format: "observation",
      topic: "Origins",
    },
    {
      text: "Store beans in an airtight container away from light. Not the freezer, not the fridge. Use them within 4 weeks of the roast date.",
      format: "tip",
      topic: "Product",
    },
    {
      text: "A customer has bought the same bag every Monday for three years. Yesterday she brought us a painting of the shop. It's hanging by the register now.",
      format: "story",
      topic: "Community",
      mediaType: "IMAGE",
    },
    {
      text: "If your coffee bag doesn't have a roast date, it's not fresh coffee. It's coffee-shaped decor.",
      format: "hot_take",
      topic: "Product",
    },
    {
      text: "What happens before your bag ships:\n\n1. Green coffee sampled and cupped\n2. Roast profile tested 3–5 times\n3. Rested 48 hours\n4. Cupped again\n5. Packed by hand",
      format: "list",
      topic: "Behind the scenes",
    },
    {
      text: "Pour-over, French press, espresso or drip? Tell us how you brew and we'll recommend a bag.",
      format: "question",
      topic: "Brewing",
    },
    {
      text: "Our Colombian producer, Doña Elena, switched to natural processing two years ago against everyone's advice. This harvest scored 88. We're very glad she didn't listen.",
      format: "story",
      topic: "Origins",
      mediaType: "IMAGE",
    },
    {
      text: "Water is 98% of your cup. If your tap water tastes off, your coffee will too. A simple filter jug makes a real difference.",
      format: "tip",
      topic: "Brewing",
    },
    {
      text: "Best part of running a cafe: watching strangers become regulars, then regulars become friends.",
      format: "observation",
      topic: "Community",
    },
    {
      text: "Latte art is lovely. Temperature and texture matter more.",
      format: "hot_take",
      topic: "Brewing",
    },
    {
      text: "New this month:\n\n• Guji, Ethiopia (light)\n• Huila, Colombia (medium)\n• House espresso, now with more chocolate notes\n• A decaf that doesn't taste like decaf",
      format: "list",
      topic: "Product",
      mediaType: "IMAGE",
    },
    {
      text: "We burned 30kg of coffee last week when the roaster's sensor failed. Painful. It's fixed now. Thanks for your patience with slower shipping.",
      format: "story",
      topic: "Behind the scenes",
    },
    {
      text: "What should we name our new winter blend? Best reply gets a bag on us.",
      format: "question",
      topic: "Community",
    },
  ],
  suggestions: {
    followers: [
      {
        text: "Meet the farmers, part 1: Doña Elena in Huila, Colombia. Every Friday we'll introduce someone who grows your coffee.",
        format: "series",
        hook: "A weekly series gives people a reason to follow.",
        rationale: "Origin stories are your most reposted posts. A recurring series turns reposts into follows.",
        goalFit: 87,
        bestSlot: { weekday: 5, hour: 8 },
      },
      {
        text: "Save this: the only 3 brew ratios you need.\n\n• Pour-over 1:16\n• French press 1:15\n• Cold brew 1:8 (dilute 1:1)",
        format: "list",
        hook: "Short, useful and made to be saved.",
        rationale: "Brewing tips get shared more than any other topic you post about.",
        goalFit: 84,
        bestSlot: { weekday: 6, hour: 8 },
      },
      {
        text: "Coffee tastes better when you know who grew it. That's the whole idea behind Fern & Fig.",
        format: "observation",
        hook: "A one-line 'why us' for people deciding whether to follow.",
        rationale: "Profile visitors convert better when your mission is easy to find. Pin this one.",
        goalFit: 76,
        bestSlot: { weekday: 2, hour: 15 },
      },
    ],
    views: [
      {
        text: "Hot take: your 'fancy' coffee tastes burnt because it was roasted for consistency, not flavor.",
        format: "hot_take",
        hook: "Challenges something people buy every week.",
        rationale: "Your hot takes get about twice your median views.",
        goalFit: 89,
        bestSlot: { weekday: 6, hour: 8 },
      },
      {
        text: "The 30-second fix for bitter coffee: use water just off the boil, not boiling.",
        format: "tip",
        hook: "Promises a fix in the first five words.",
        rationale: "Quick fixes travel. Saturday mornings are when your views peak.",
        goalFit: 84,
        bestSlot: { weekday: 6, hour: 7 },
      },
      {
        text: "Is $22 for a bag of specialty coffee too much? Genuinely asking. We'll share what goes into the price.",
        format: "question",
        hook: "Price talk invites debate and quotes.",
        rationale: "Quotes push you out to non-followers, and price posts get quoted most.",
        goalFit: 80,
        bestSlot: { weekday: 3, hour: 15 },
      },
    ],
    engagement: [
      {
        text: "Describe your perfect cup of coffee in 3 words. We'll go first: bright, sweet, clean.",
        format: "question",
        hook: "Three words is the easiest reply there is.",
        rationale: "Your questions get over 3× the replies of your other posts.",
        goalFit: 92,
        bestSlot: { weekday: 1, hour: 8 },
      },
      {
        text: "We're picking next month's single origin. Ethiopia, Kenya or Guatemala? Most replies wins.",
        format: "question",
        hook: "Gives followers a real say.",
        rationale: "Letting followers decide gets your highest reply rate.",
        goalFit: 88,
        bestSlot: { weekday: 4, hour: 15 },
      },
      {
        text: "The first coffee we ever roasted was terrible. We drank it anyway. What's the worst cup you've ever made at home?",
        format: "story",
        hook: "Opens with a confession, ends with an easy question.",
        rationale: "Behind-the-scenes stories with a question get both likes and replies.",
        goalFit: 83,
        bestSlot: { weekday: 0, hour: 11 },
      },
    ],
  },
  upNext: {
    text: "Winter blend drops Friday at 9am. Chocolate, orange peel, a little spice. The first 100 bags come with a free tasting card.",
    weekday: 5,
    hour: 9,
  },
};

export const DEMO_PERSONAS: Record<DemoPersonaId, DemoPersona> = { creator, expert, brand };
