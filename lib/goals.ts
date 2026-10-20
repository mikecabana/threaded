export const GOALS = ["followers", "views", "engagement"] as const;

export type Goal = (typeof GOALS)[number];

export const DEFAULT_GOAL: Goal = "engagement";

export const GOAL_COOKIE = "threaded_goal";

export interface GoalMeta {
  id: Goal;
  label: string;
  short: string;
  northStar: string;
  pitch: string;
  levers: string[];
}

export const GOAL_META: Record<Goal, GoalMeta> = {
  followers: {
    id: "followers",
    label: "More Followers",
    short: "Followers",
    northStar: "Daily follower growth",
    pitch: "Posts people repost and that make your profile worth following.",
    levers: ["Niche consistency", "Value-dense posts", "Series", "Soft CTAs"],
  },
  views: {
    id: "views",
    label: "More Views",
    short: "Views",
    northStar: "Views per post vs. your median",
    pitch: "Scroll-stopping first lines, posted when your audience is awake.",
    levers: ["Hooks", "Timely angles", "Topic tags", "Peak hours"],
  },
  engagement: {
    id: "engagement",
    label: "More Engagement",
    short: "Engagement",
    northStar: "Engagement rate, replies weighted most",
    pitch: "Conversation starters your audience can't resist answering.",
    levers: ["Open questions", "Mild hot takes", "Stories", "Easy replies"],
  },
};

export function isGoal(value: unknown): value is Goal {
  return typeof value === "string" && (GOALS as readonly string[]).includes(value);
}
