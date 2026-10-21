import { Eye, MessageCircle, Users } from "lucide-react";
import type { Goal } from "@/lib/goals";

const ICONS = { followers: Users, views: Eye, engagement: MessageCircle } as const;

export function GoalIcon({ goal, className }: { goal: Goal; className?: string }) {
  const Icon = ICONS[goal];
  return <Icon className={className} aria-hidden />;
}
