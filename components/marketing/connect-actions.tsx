"use client";

import { TriangleAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

const ERRORS: Record<string, string> = {
  denied: "Threads sign-in was cancelled. Nothing was connected.",
  state: "That sign-in link expired. Please try again.",
  threads: "Threads didn't let us finish signing you in. Please try again in a minute.",
  unavailable: "Threads sign-in isn't available right now.",
};

/** Shows why the last sign-in attempt failed, if it did. */
export function ConnectError() {
  const error = useSearchParams().get("error");
  const message = error ? ERRORS[error] : undefined;
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-4 flex items-center gap-2 rounded-xl border border-negative/30 bg-negative/10 px-3 py-2 text-fg text-sm"
    >
      <TriangleAlert className="size-4 shrink-0 text-negative" aria-hidden />
      {message}
    </p>
  );
}

/** Starts the OAuth flow, passing the browser's timezone for best-time-to-post maths. */
export function ConnectButton() {
  return (
    <Button
      size="lg"
      className="w-full"
      onClick={() => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        window.location.assign(`/api/auth/threads/start?tz=${encodeURIComponent(tz)}`);
      }}
    >
      Continue with Threads
    </Button>
  );
}
