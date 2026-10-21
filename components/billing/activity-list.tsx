import { Gift, Hourglass, Repeat, ShoppingBag, SlidersHorizontal, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ActivityItem } from "@/lib/data/billing";
import { cn } from "@/lib/utils";

const ICONS = {
  purchase: ShoppingBag,
  auto_recharge: Repeat,
  trial: Gift,
  usage: Sparkles,
  expire: Hourglass,
  adjust: SlidersHorizontal,
  refund: SlidersHorizontal,
} as const;

export function ActivityList({ items, formatDate }: { items: ActivityItem[]; formatDate: (date: Date) => string }) {
  return (
    <Card className="p-5">
      <h2 className="font-medium">Activity</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-muted text-sm">Nothing yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border" aria-label="Credit activity">
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <li key={item.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  <span className="block text-subtle text-xs">{formatDate(item.at)}</span>
                </span>
                <span className={cn("font-mono", item.credits > 0 ? "text-positive" : "text-muted")}>
                  {item.credits > 0 ? "+" : "−"}
                  {Math.abs(item.credits).toLocaleString("en-US")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
