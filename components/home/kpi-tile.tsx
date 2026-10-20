import { TrendingDown, TrendingUp } from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { Sparkline } from "@/components/motion/sparkline";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { Kpi } from "@/lib/analysis/summary";
import { formatDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

export function KpiTile({ kpi, northStar = false }: { kpi: Kpi; northStar?: boolean }) {
  const up = (kpi.delta ?? 0) >= 0;
  return (
    <Card
      className={cn(
        "flex flex-col p-4",
        northStar && "border-accent/40 shadow-[0_12px_40px_-20px_color-mix(in_oklch,var(--accent)_60%,transparent)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate font-medium text-muted text-xs" title={kpi.hint}>
          {kpi.label}
        </p>
        {northStar && (
          <Badge variant="accent" className="hidden lg:inline-flex">
            North star
          </Badge>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <CountUp value={kpi.value} format={kpi.format} className="font-semibold text-2xl tracking-tight" />
        {kpi.delta !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium text-xs tabular",
              up ? "text-positive" : "text-negative",
            )}
          >
            {up ? <TrendingUp className="size-3.5" aria-hidden /> : <TrendingDown className="size-3.5" aria-hidden />}
            {formatDelta(kpi.delta, kpi.deltaKind)}
          </span>
        )}
      </div>
      <Sparkline values={kpi.series} className="mt-3 h-9" />
    </Card>
  );
}
