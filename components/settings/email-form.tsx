"use client";

import { Mail } from "lucide-react";
import { useActionState } from "react";
import { SubmitButton } from "@/components/billing/submit-button";
import { type EmailFormState, requestEmailAction } from "@/lib/actions/email";
import { cn } from "@/lib/utils";

/** Add (or change) the alert address; it's saved once the link we email is opened. */
export function EmailForm({ current }: { current: string | null }) {
  const [state, action] = useActionState<EmailFormState, FormData>(requestEmailAction, null);
  return (
    <form action={action} className="space-y-2">
      <label className="block">
        <span className="mb-1.5 flex items-center gap-1.5 text-sm">
          <Mail className="size-3.5" aria-hidden /> {current ? "Change email" : "Email for alerts"}
        </span>
        <div className="flex flex-wrap gap-2">
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            placeholder="you@example.com"
            className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle focus-visible:border-accent"
          />
          <SubmitButton size="md">Send link</SubmitButton>
        </div>
      </label>
      {state && (
        <p role="status" className={cn("text-sm", state.ok ? "text-muted" : "text-negative")}>
          {state.message}
        </p>
      )}
    </form>
  );
}
