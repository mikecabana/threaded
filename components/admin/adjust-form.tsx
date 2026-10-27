"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/billing/submit-button";
import { type AdminFormState, adjustCreditsAction } from "@/lib/actions/admin";
import { cn } from "@/lib/utils";

const field =
  "h-10 w-full min-w-0 rounded-xl border border-border-strong bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle focus-visible:border-accent";

/** Add or take back credits, with a reason. `token` makes a double submit apply once. */
export function AdjustForm({ workspaceId, token }: { workspaceId: string; token: string }) {
  const [state, action] = useActionState<AdminFormState, FormData>(adjustCreditsAction, null);
  return (
    <form action={action} className="space-y-3" aria-label="Adjust credits">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="token" value={token} />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="grid gap-1 text-sm">
          Credits
          <input name="amount" type="number" step="1" required placeholder="100 or -100" className={field} />
        </label>
        <label className="grid gap-1 text-sm">
          Reason
          <input
            name="reason"
            required
            minLength={3}
            maxLength={200}
            placeholder="e.g. Refund for a failed batch"
            className={field}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm">Apply</SubmitButton>
        {state && (
          <p role="status" className={cn("text-sm", state.ok ? "text-muted" : "text-negative")}>
            {state.message}
          </p>
        )}
      </div>
      <p className="text-subtle text-xs">
        Positive adds credits, negative takes them back (never below zero). For a card refund, refund the payment in
        Stripe first, then take the credits back here.
      </p>
    </form>
  );
}
