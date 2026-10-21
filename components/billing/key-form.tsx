"use client";

import { KeyRound } from "lucide-react";
import { useActionState } from "react";
import { type BillingFormState, saveKeyAction } from "@/lib/actions/billing";
import { cn } from "@/lib/utils";
import { SubmitButton } from "./submit-button";

/** Paste a Vercel AI Gateway key; it's checked against the Gateway before it's saved. */
export function KeyForm({ submitLabel, disabled }: { submitLabel: string; disabled?: boolean }) {
  const [state, action] = useActionState<BillingFormState, FormData>(saveKeyAction, null);
  return (
    <form action={action} className="space-y-2">
      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm">
          <KeyRound className="size-3.5" aria-hidden /> Vercel AI Gateway key
        </span>
        <input
          name="key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          disabled={disabled}
          placeholder="vck_…"
          className="h-10 w-full rounded-xl border border-border-strong bg-surface-2 px-3 font-mono text-sm outline-none placeholder:text-subtle focus-visible:border-accent"
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-subtle text-xs">Stored encrypted. Only the last four characters are ever shown.</p>
        <SubmitButton size="sm" disabled={disabled}>
          {submitLabel}
        </SubmitButton>
      </div>
      {state && (
        <p role="status" className={cn("text-sm", state.ok ? "text-muted" : "text-negative")}>
          {state.message}
        </p>
      )}
    </form>
  );
}
