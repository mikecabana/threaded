"use client";

import { CreditCard } from "lucide-react";
import { useActionState, useState } from "react";
import { Card } from "@/components/ui/card";
import { type BillingFormState, saveAutoRechargeAction } from "@/lib/actions/billing";
import type { AutoRechargeSettings } from "@/lib/db/schema";
import { CREDIT_PACKS, RECHARGE_THRESHOLDS } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { SubmitButton } from "./submit-button";

const selectClass =
  "h-10 w-full rounded-xl border border-border-strong bg-surface-2 px-2 text-sm outline-none focus-visible:border-accent disabled:opacity-50";

export function AutoRechargeForm({
  settings,
  card,
  unavailable,
}: {
  settings: AutoRechargeSettings;
  /** The saved card, e.g. "Visa •••• 4242", if there is one. */
  card: string | null;
  unavailable?: string;
}) {
  const [state, action] = useActionState<BillingFormState, FormData>(saveAutoRechargeAction, null);
  const [enabled, setEnabled] = useState(settings.enabled);
  const needsCard = enabled && !card;

  return (
    <Card className="p-5">
      <form action={action} className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium">Auto-recharge</h2>
            <p className="mt-0.5 text-muted text-sm">Never run out mid-batch. We buy a pack when you get low.</p>
          </div>
          <label className="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              name="enabled"
              role="switch"
              aria-label="Auto-recharge"
              aria-checked={enabled}
              checked={enabled}
              disabled={Boolean(unavailable)}
              onChange={(e) => setEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden
              className={cn(
                "h-6 w-11 rounded-full border border-border-strong bg-surface-2 transition-colors",
                "peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50",
                "after:absolute after:top-1 after:left-1 after:size-4 after:rounded-full after:bg-fg after:transition-transform",
                "peer-checked:after:translate-x-5 peer-checked:after:bg-accent-ink",
              )}
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm">When my balance drops below</span>
            <select
              name="thresholdCredits"
              defaultValue={String(settings.thresholdCredits)}
              disabled={!enabled}
              className={selectClass}
            >
              {RECHARGE_THRESHOLDS.map((t) => (
                <option key={t} value={t}>
                  {t} credits
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm">Buy</span>
            <select name="packId" defaultValue={settings.packId} disabled={!enabled} className={selectClass}>
              {CREDIT_PACKS.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.credits.toLocaleString("en-US")} credits for ${pack.usd}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* Disabled selects aren't submitted; keep the saved values when turning it off. */}
        {!enabled && (
          <>
            <input type="hidden" name="thresholdCredits" value={settings.thresholdCredits} />
            <input type="hidden" name="packId" value={settings.packId} />
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-sm text-subtle">
            <CreditCard className="size-4" aria-hidden />
            {card
              ? `Charges ${card}`
              : "You'll save a card on the next step. It's only charged when your balance gets low."}
          </p>
          <SubmitButton size="sm" disabled={Boolean(unavailable)}>
            {needsCard ? "Continue to add a card" : "Save"}
          </SubmitButton>
        </div>
        {(state || unavailable) && (
          <p role="status" className={cn("text-sm", state && !state.ok ? "text-negative" : "text-muted")}>
            {state?.message ?? unavailable}
          </p>
        )}
      </form>
    </Card>
  );
}
