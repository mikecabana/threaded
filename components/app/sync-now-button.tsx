"use client";

import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { type SyncNowResult, syncNowAction } from "@/lib/actions/sync";

const MESSAGES: Record<Exclude<SyncNowResult, { ok: true }>["reason"], string> = {
  not_signed_in: "Sign in again to sync.",
  too_soon: "Synced a few minutes ago. Try again shortly.",
  running: "A sync is already running.",
};

export function SyncNowButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await syncNowAction();
            setMessage(result.ok ? "Sync started. New data shows up in a minute or two." : MESSAGES[result.reason]);
          })
        }
      >
        {pending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        Sync now
      </Button>
      {message && (
        <p className="text-subtle text-xs" aria-live="polite">
          {message}
        </p>
      )}
    </div>
  );
}
