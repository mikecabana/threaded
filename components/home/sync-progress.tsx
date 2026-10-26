"use client";

import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { m } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CountUp } from "@/components/motion/count-up";
import { revealSpring } from "@/components/motion/springs";
import { Button } from "@/components/ui/button";
import { syncNowAction } from "@/lib/actions/sync";
import type { SyncStatus } from "@/lib/sync/status";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: "posts", label: "Reading your posts" },
  { id: "insights", label: "Measuring what landed" },
  { id: "account", label: "Mapping your audience's days" },
] as const;

const ORDER = ["posts", "insights", "account", "classify", "dna", "done"];
/** Once the account's data is in, Home can show it while the posts are still being classified. */
const READY = ORDER.indexOf("classify");

/**
 * Live progress of the first sync. Polls the status endpoint while the run is
 * going and refreshes the page as soon as the data is in (classifying the
 * posts and building Profile DNA carry on in the background).
 */
export function SyncProgress({ initial }: { initial: SyncStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (status.status !== "running") return;
    const id = window.setInterval(async () => {
      const response = await fetch("/api/sync/status", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const next = (await response.json()) as SyncStatus;
      setStatus(next);
      if (next.status === "succeeded" || ORDER.indexOf(next.step ?? "") >= READY) router.refresh();
    }, 2000);
    return () => window.clearInterval(id);
  }, [status.status, router]);

  function retry() {
    setNotice(null);
    startTransition(async () => {
      const result = await syncNowAction();
      if (result.ok || result.reason === "running") setStatus({ status: "running", step: "posts", stats: null });
      else setNotice(result.reason === "too_soon" ? "Synced a moment ago. Try again in a few minutes." : null);
    });
  }

  const current = ORDER.indexOf(status.step ?? "posts");
  const stats = status.stats ?? {};

  if (status.status === "idle" || status.status === "failed") {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-muted">
          {status.status === "failed"
            ? "The sync stopped before it finished. Threads may be busy; it's safe to try again."
            : "Your first sync hasn't started yet."}
        </p>
        <Button onClick={retry} disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {status.status === "failed" ? "Try again" : "Start sync"}
        </Button>
        {notice && <p className="text-sm text-subtle">{notice}</p>}
      </div>
    );
  }

  return (
    <ol className="w-full max-w-sm text-left" aria-live="polite">
      {STEPS.map((step, i) => {
        const index = ORDER.indexOf(step.id);
        const done = current > index || status.status === "succeeded";
        const active = current === index && !done;
        const count = step.id === "posts" ? stats.posts : step.id === "insights" ? stats.measured : stats.days;
        return (
          <li key={step.id} className="flex gap-4">
            <div className="flex flex-col items-center">
              <m.span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border-2 transition-colors",
                  done ? "border-accent bg-accent text-accent-ink" : active ? "border-accent" : "border-border-strong",
                )}
                animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={active ? { duration: 1.6, repeat: Number.POSITIVE_INFINITY } : revealSpring}
              >
                {done ? (
                  <Check className="size-4" aria-hidden />
                ) : active ? (
                  <span className="size-2 rounded-full bg-accent" />
                ) : null}
              </m.span>
              {i < STEPS.length - 1 && (
                <span className="relative my-1 block min-h-8 w-0.5 flex-1 overflow-hidden rounded-full bg-border-strong">
                  <m.span
                    className="absolute inset-x-0 top-0 block origin-top bg-accent"
                    initial={false}
                    animate={{ scaleY: done ? 1 : 0 }}
                    style={{ height: "100%" }}
                    transition={revealSpring}
                  />
                </span>
              )}
            </div>
            <div className="flex flex-1 items-baseline justify-between gap-3 pt-0.5 pb-6">
              <span className={cn("font-medium", done || active ? "text-fg" : "text-subtle")}>{step.label}</span>
              {count !== undefined && (done || active) && (
                <CountUp value={count} className="font-mono text-muted text-sm" />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
