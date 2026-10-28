import { CalendarSync } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { setMonthlyPlanEndingAction, startMonthlyPlanAction } from "@/lib/actions/billing";
import { isLivePlan } from "@/lib/billing/subscription";
import type { BillingOverview } from "@/lib/data/billing";
import { CREDIT_PACKS, MONTHLY_PLAN } from "@/lib/pricing";
import { ManagePlanButton } from "./own-key-card";
import { SubmitButton } from "./submit-button";

const perDollar = (credits: number, usd: number) => Math.round(credits / usd);

/**
 * The Monthly plan, the best value per credit. The states: not on it; on it;
 * on it but set to end; its payment failing; or blocked by a running own-key
 * plan (one plan at a time).
 */
export function MonthlyPlanCard({
  plan: current,
  batchCredits,
  formatDate,
  unavailable,
}: {
  plan: BillingOverview["plan"];
  batchCredits: number;
  formatDate: (date: Date) => string;
  unavailable?: string;
}) {
  const plan = current?.kind === "monthly" ? current : null;
  const live = isLivePlan(plan?.status);
  const periodEnd = plan?.periodEnd ? formatDate(plan.periodEnd) : null;
  const ownKeyRunning = current?.kind === "own_key" && isLivePlan(current.status) && !current.cancelAtPeriodEnd;
  const packRange = CREDIT_PACKS.map((pack) => perDollar(pack.credits, pack.usd));

  return (
    <Card className="space-y-4 border-accent/40 p-5" role="region" aria-labelledby="monthly-plan">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="monthly-plan" className="flex items-center gap-2 font-medium">
            <CalendarSync className="size-4 text-accent" aria-hidden /> Monthly plan
          </h2>
          <p className="mt-1">
            <span className="font-semibold text-2xl tracking-tight">${MONTHLY_PLAN.usd}</span>
            <span className="text-muted text-sm">
              {" "}
              / month for {MONTHLY_PLAN.credits.toLocaleString("en-US")} credits
            </span>
          </p>
        </div>
        <Badge variant="accent">{live ? "Your plan" : "Best value"}</Badge>
      </div>
      <p className="text-muted text-sm">
        {perDollar(MONTHLY_PLAN.credits, MONTHLY_PLAN.usd)} credits per dollar, against {packRange[0]}–
        {packRange.at(-1)} with packs: about {Math.floor(MONTHLY_PLAN.credits / Math.max(1, batchCredits))} batches of
        three ideas a month. Credits never expire, so a quiet month carries over. Cancel any time.
      </p>

      {plan?.status === "past_due" && (
        <p className="rounded-xl bg-negative/10 px-3 py-2 text-sm">
          The last payment for your plan failed. Update your card to keep getting credits.
        </p>
      )}

      {live && !plan?.cancelAtPeriodEnd ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm">
            Your next {MONTHLY_PLAN.credits.toLocaleString("en-US")} credits come{" "}
            {periodEnd ? `on ${periodEnd}` : "next month"}.
          </p>
          <ManagePlanButton disabled={Boolean(unavailable)} />
          <form action={setMonthlyPlanEndingAction}>
            <input type="hidden" name="ending" value="end" />
            <SubmitButton variant="ghost" size="sm">
              Cancel plan
            </SubmitButton>
          </form>
        </div>
      ) : live ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm">Your plan ends on {periodEnd}. The credits you have stay.</p>
          <form action={setMonthlyPlanEndingAction}>
            <input type="hidden" name="ending" value="keep" />
            <SubmitButton size="sm">Keep my plan</SubmitButton>
          </form>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <form action={startMonthlyPlanAction}>
            <SubmitButton size="sm" disabled={Boolean(unavailable) || ownKeyRunning}>
              Start the Monthly plan
            </SubmitButton>
          </form>
          {ownKeyRunning && (
            <p className="text-sm text-subtle">You're on your own key. Switch back to credits first.</p>
          )}
        </div>
      )}
      {unavailable && <p className="text-sm text-subtle">{unavailable}</p>}
    </Card>
  );
}
