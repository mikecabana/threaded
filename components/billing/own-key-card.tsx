import { ExternalLink } from "lucide-react";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { openPortalAction, startPlanAction, switchToCreditsAction } from "@/lib/actions/billing";
import { savedKeyBalance } from "@/lib/billing/byok";
import { isLivePlan } from "@/lib/billing/subscription";
import type { BillingOverview } from "@/lib/data/billing";
import { BYOK_PLATFORM_FEE_USD } from "@/lib/pricing";
import { KeyForm } from "./key-form";
import { SubmitButton } from "./submit-button";

/**
 * Bring-your-own-key. The states: not set up; key saved but the plan not
 * started; running on the key; switched back with the plan running out; and
 * the plan's payment failing.
 */
export function OwnKeyCard({
  workspaceId,
  overview,
  formatDate,
  unavailable,
}: {
  workspaceId: string;
  overview: BillingOverview;
  formatDate: (date: Date) => string;
  unavailable?: string;
}) {
  const { mode, keyLast4, plan } = overview;
  const live = isLivePlan(plan?.status);
  const periodEnd = plan?.periodEnd ? formatDate(plan.periodEnd) : null;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium">Use your own AI key</h2>
          <p className="mt-0.5 text-muted text-sm">
            Run AI on your own Vercel AI Gateway account and pay Vercel directly, for a flat ${BYOK_PLATFORM_FEE_USD}
            /month that covers syncing, analytics and scheduling. Your credits stay put.
          </p>
        </div>
        {mode === "byok" && <Badge variant="accent">On</Badge>}
      </div>

      {plan?.status === "past_due" && (
        <p className="rounded-xl bg-negative/10 px-3 py-2 text-sm">
          The last payment for your plan failed. Update your card to keep using your key.
        </p>
      )}

      {mode === "byok" ? (
        <>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-subtle">Key</dt>
              <dd className="font-mono">•••• {keyLast4}</dd>
            </div>
            <div>
              <dt className="text-subtle">Gateway balance</dt>
              <dd>
                <Suspense fallback={<span className="text-subtle">Checking…</span>}>
                  <GatewayBalance workspaceId={workspaceId} />
                </Suspense>
              </dd>
            </div>
            <div>
              <dt className="text-subtle">Plan</dt>
              <dd>{periodEnd ? `Renews ${periodEnd}` : "Active"}</dd>
            </div>
          </dl>
          <details className="group rounded-xl border border-border px-3 py-2">
            <summary className="cursor-pointer text-sm">Replace key</summary>
            <div className="pt-3">
              <KeyForm submitLabel="Check and save" />
            </div>
          </details>
          <div className="flex flex-wrap gap-2">
            <form action={switchToCreditsAction}>
              <SubmitButton variant="outline" size="sm">
                Switch back to credits
              </SubmitButton>
            </form>
            <ManagePlanButton disabled={Boolean(unavailable)} />
          </div>
          <p className="text-subtle text-xs">
            Switching back deletes your key here. The plan stays until {periodEnd ?? "the end of the period"}, then
            ends.
          </p>
        </>
      ) : keyLast4 && !live ? (
        <>
          <p className="text-sm">
            Key <span className="font-mono">•••• {keyLast4}</span> is saved. Start the plan to use it.
          </p>
          <div className="flex flex-wrap gap-2">
            <form action={startPlanAction}>
              <SubmitButton size="sm" disabled={Boolean(unavailable)}>
                Start the ${BYOK_PLATFORM_FEE_USD}/month plan
              </SubmitButton>
            </form>
            <form action={switchToCreditsAction}>
              <SubmitButton variant="ghost" size="sm">
                Remove key
              </SubmitButton>
            </form>
          </div>
        </>
      ) : (
        <>
          {live && plan?.cancelAtPeriodEnd && (
            <p className="text-sm">
              Your plan ends on {periodEnd}. Add a key before then to keep it, at no extra cost.
            </p>
          )}
          <KeyForm
            submitLabel={
              live ? "Check and use this key" : `Check key and continue to the $${BYOK_PLATFORM_FEE_USD} plan`
            }
            disabled={Boolean(unavailable)}
          />
        </>
      )}
      {unavailable && <p className="text-sm text-subtle">{unavailable}</p>}
    </Card>
  );
}

async function GatewayBalance({ workspaceId }: { workspaceId: string }) {
  const balance = await savedKeyBalance(workspaceId);
  if (balance === null) return <span className="text-negative">Can't reach your key</span>;
  return <span className={balance <= 0 ? "text-negative" : undefined}>${balance.toFixed(2)}</span>;
}

export function ManagePlanButton({ disabled, label = "Manage plan" }: { disabled?: boolean; label?: string }) {
  return (
    <form action={openPortalAction}>
      <SubmitButton variant="ghost" size="sm" disabled={disabled}>
        {label} <ExternalLink aria-hidden />
      </SubmitButton>
    </form>
  );
}
