"use client";

import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CountUp } from "@/components/motion/count-up";
import { revealSpring, uiSpring } from "@/components/motion/springs";
import { Button } from "@/components/ui/button";
import { syncNowAction } from "@/lib/actions/sync";
import type { SyncStatus } from "@/lib/sync/status";
import { cn } from "@/lib/utils";

const ORDER = ["posts", "insights", "account", "classify", "dna", "done"];
/** From here on the account's data is in; the rest is enrichment. */
const DATA_IN = ORDER.indexOf("classify");

const STEPS = [
  { id: "posts", label: "Reading your posts" },
  { id: "insights", label: "Measuring what landed" },
  { id: "account", label: "Mapping your audience's days" },
  { id: "classify", label: "Sorting your posts into topics" },
  { id: "dna", label: "Finding your voice" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function Counter({ step, stats }: { step: StepId; stats: Record<string, number> }) {
  if (step === "posts" && stats.posts !== undefined) return <CountUp value={stats.posts} />;
  if (step === "insights" && stats.posts) {
    return (
      <>
        <CountUp value={stats.measured ?? 0} />
        <span className="text-subtle">/{stats.posts}</span>
      </>
    );
  }
  if (step === "account" && stats.days !== undefined) return <CountUp value={stats.days} />;
  if (step === "classify" && stats.classified) return <CountUp value={stats.classified} />;
  return null;
}

/**
 * The Read: the first sync, step by step on the thread line, driven by the
 * real workflow run. When it's done it moves on to the DNA reveal (or Home,
 * when there's no DNA to show yet).
 */
export function TheRead({ firstName, initial }: { firstName: string; initial: SyncStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const finished = status.status === "succeeded";

  useEffect(() => {
    if (status.status !== "running") return;
    const id = window.setInterval(async () => {
      const response = await fetch("/api/sync/status", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      setStatus((await response.json()) as SyncStatus);
    }, 1000);
    return () => window.clearInterval(id);
  }, [status.status]);

  // Watched live to the end: a beat to see it finish, then the reveal.
  useEffect(() => {
    if (initial.status === "succeeded" || status.status !== "succeeded") return;
    const next = (status.stats?.dna ?? 0) > 0 ? "/onboarding/dna" : "/home";
    const id = window.setTimeout(() => router.push(next), 1200);
    return () => window.clearTimeout(id);
  }, [initial.status, status.status, status.stats, router]);

  function retry() {
    setNotice(null);
    startTransition(async () => {
      const result = await syncNowAction();
      if (result.ok || result.reason === "running") setStatus({ status: "running", step: "posts", stats: null });
      else setNotice(result.reason === "too_soon" ? "Synced a moment ago. Try again in a few minutes." : null);
    });
  }

  const current = finished ? ORDER.length : ORDER.indexOf(status.step ?? "posts");
  const stats = status.stats ?? {};
  const topics = status.topics ?? [];

  return (
    <div className="mx-auto max-w-lg py-8 sm:py-14">
      <m.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={revealSpring}>
        <p className="font-medium text-accent text-sm">The Read</p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight sm:text-4xl">
          {finished ? `All set, ${firstName}.` : `Reading your Threads, ${firstName}.`}
        </h1>
        <p className="mt-3 text-muted leading-relaxed">
          {status.status === "failed"
            ? "The sync stopped before it finished. Threads may be busy; it's safe to try again."
            : status.status === "idle"
              ? "Your first sync hasn't started yet."
              : "We're learning what your audience rewards and how you write. This usually takes a minute or two."}
        </p>
      </m.div>

      {status.status === "failed" || status.status === "idle" ? (
        <div className="mt-8 flex flex-col items-start gap-3">
          <Button onClick={retry} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {status.status === "failed" ? "Try again" : "Start sync"}
          </Button>
          {notice && <p className="text-sm text-subtle">{notice}</p>}
        </div>
      ) : (
        <ol className="mt-10" aria-live="polite">
          {STEPS.map((step, i) => {
            const index = ORDER.indexOf(step.id);
            const done = current > index;
            const active = current === index;
            return (
              <m.li
                key={step.id}
                className="flex gap-4"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ ...revealSpring, delay: 0.15 + i * 0.08 }}
              >
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      done && "border-accent bg-accent text-accent-ink",
                      active && "border-accent text-accent",
                      !done && !active && "border-border-strong text-subtle",
                    )}
                  >
                    {done ? (
                      <Check className="size-4" />
                    ) : active ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : null}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span className="relative my-1 w-0.5 flex-1 overflow-hidden rounded-full bg-border-strong">
                      <m.span
                        className="absolute inset-0 origin-top bg-accent"
                        initial={false}
                        animate={{ scaleY: done ? 1 : 0 }}
                        transition={revealSpring}
                      />
                    </span>
                  )}
                </div>
                <div className="min-h-16 flex-1 pb-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={cn("font-medium", !done && !active && "text-subtle")}>{step.label}</p>
                    <span className="font-mono text-sm tabular-nums">
                      <Counter step={step.id} stats={stats} />
                    </span>
                  </div>
                  {step.id === "classify" && topics.length > 0 && current >= index && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <AnimatePresence>
                        {topics.map((topic, t) => (
                          <m.span
                            key={topic}
                            className="rounded-full bg-accent/15 px-2.5 py-0.5 text-accent text-xs"
                            initial={{ opacity: 0, scale: 0.6 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ ...uiSpring, delay: t * 0.06 }}
                          >
                            {topic}
                          </m.span>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                  {step.id === "dna" && done && <p className="mt-1 text-muted text-sm">Your Profile DNA is ready.</p>}
                </div>
              </m.li>
            );
          })}
        </ol>
      )}

      {(finished || current >= DATA_IN) && (
        <m.div
          className="mt-2 flex flex-wrap items-center gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          {finished && initial.status === "succeeded" ? (
            <Button asChild>
              <Link href={(stats.dna ?? 0) > 0 ? "/onboarding/dna" : "/home"}>Continue</Link>
            </Button>
          ) : (
            !finished && (
              <Link href="/home" className="text-muted text-sm underline-offset-4 hover:text-fg hover:underline">
                Your numbers are in. Skip to your dashboard
              </Link>
            )
          )}
        </m.div>
      )}
    </div>
  );
}
