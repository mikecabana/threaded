import { Coins } from "lucide-react";
import Link from "next/link";
import { CountUp } from "@/components/motion/count-up";
import { creditsToUsd } from "@/lib/pricing";

/** Header balance. Phase 1 animates a floating "−6" here when a generation settles. */
export function CreditsPill({ credits }: { credits: number }) {
  return (
    <Link
      href="/settings"
      title={`${credits} credits (about $${creditsToUsd(credits).toFixed(2)})`}
      className="flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3 font-medium text-sm transition-colors hover:border-border-strong"
    >
      <Coins className="size-4 text-accent" aria-hidden />
      <CountUp value={credits} className="font-mono" />
      <span className="text-subtle">cr</span>
    </Link>
  );
}
