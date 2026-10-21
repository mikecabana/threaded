import { Coins, Repeat } from "lucide-react";
import { CountUp } from "@/components/motion/count-up";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { AutoRechargeSettings } from "@/lib/db/schema";
import { creditsToUsd, packById } from "@/lib/pricing";

export function BalanceCard({
  credits,
  mode,
  batchCredits,
  autoRecharge,
}: {
  credits: number;
  mode: "credits" | "byok";
  /** Typical credits for a batch of three ideas on the default model. */
  batchCredits: number;
  autoRecharge: AutoRechargeSettings | null;
}) {
  const batches = Math.floor(credits / Math.max(1, batchCredits));
  const pack = autoRecharge?.enabled ? packById(autoRecharge.packId) : undefined;
  return (
    <Card className="relative overflow-hidden p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-accent/15 blur-3xl"
      />
      <div className="relative flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="flex items-center gap-1.5 text-muted text-sm">
            <Coins className="size-4 text-accent" aria-hidden /> Balance
          </p>
          <p className="mt-1 flex items-baseline gap-2">
            <CountUp value={credits} className="font-mono font-semibold text-5xl tracking-tight" />
            <span className="text-muted">credits</span>
          </p>
          <p className="mt-1 text-sm text-subtle">
            Worth ${creditsToUsd(credits).toFixed(2)}, about {batches.toLocaleString("en-US")}{" "}
            {batches === 1 ? "batch" : "batches"} of three ideas
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 text-sm sm:items-end">
          {mode === "byok" ? (
            <Badge variant="accent">Running on your own key</Badge>
          ) : (
            <Badge variant="outline">Pay as you go</Badge>
          )}
          {pack && autoRecharge && (
            <span className="flex items-center gap-1.5 text-muted">
              <Repeat className="size-3.5" aria-hidden />
              Tops up {pack.credits.toLocaleString("en-US")} below {autoRecharge.thresholdCredits}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
