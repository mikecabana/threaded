"use client";

import { TriangleAlert } from "lucide-react";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/billing/submit-button";
import { Button } from "@/components/ui/button";
import { type DeleteAccountState, deleteAccountAction, disconnectThreadsAction } from "@/lib/actions/account";

/** "Disconnect Threads", asked twice so it isn't a slip. */
export function DisconnectThreads() {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Disconnect Threads
      </Button>
    );
  }
  return (
    <form action={disconnectThreadsAction} className="flex flex-wrap items-center gap-2">
      <SubmitButton variant="secondary" size="sm">
        Yes, disconnect
      </SubmitButton>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </form>
  );
}

/** "Delete account": spells out what goes, then asks for the username. */
export function DeleteAccount({ username, consequences }: { username: string; consequences: string[] }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<DeleteAccountState, FormData>(deleteAccountAction, null);
  if (!open) {
    return (
      <Button variant="outline" size="sm" className="text-negative" onClick={() => setOpen(true)}>
        Delete account…
      </Button>
    );
  }
  return (
    <form
      action={action}
      aria-label="Delete your account"
      className="w-full space-y-3 rounded-xl border border-negative/40 bg-negative/5 p-4 text-sm"
    >
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 text-negative" aria-hidden /> This can't be undone.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-muted">
        {consequences.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <label className="block">
        <span className="mb-1.5 block">
          Type <span className="font-mono">@{username}</span> to confirm
        </span>
        <input
          name="confirm"
          autoComplete="off"
          spellCheck={false}
          required
          className="h-10 w-full rounded-xl border border-border-strong bg-surface-2 px-3 text-sm outline-none focus-visible:border-accent"
        />
      </label>
      {state?.error && (
        <p role="alert" className="text-negative">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="secondary" size="sm">
          Delete my account
        </SubmitButton>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
