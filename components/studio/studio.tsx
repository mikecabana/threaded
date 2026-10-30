"use client";

import { useObject } from "@ai-sdk/react";
import { AtSign, Globe, Sparkles, Square, TriangleAlert } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useComposer } from "@/components/composer/provider";
import type { PostAuthor } from "@/components/threads/post-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { switchToCreditsAction } from "@/lib/actions/billing";
import { setModelPickAction, setSuggestionStatusAction } from "@/lib/actions/studio";
import { type BatchContext, CONTEXT_HEADER, progressSteps, readContextHeader } from "@/lib/ai/progress";
import {
  type GenerateRequest,
  type IdeaShape,
  SPICE_LEVELS,
  type SpiceLevel,
  suggestionBatchSchema,
} from "@/lib/ai/schemas";
import { FORMAT_LABELS, POST_FORMATS } from "@/lib/analysis/formats";
import type { StoredSuggestion } from "@/lib/data/suggestions";
import { GOAL_META, type Goal } from "@/lib/goals";
import { IdeaCard, type IdeaView } from "./idea-card";
import { ProgressTimeline } from "./progress-timeline";

export interface StudioModel {
  modelId: string;
  label: string;
  tier: "fast" | "balanced" | "best";
  /** Typical credits for a batch of 3 and of 5, of single posts or of threads. */
  credits: Record<IdeaShape, { 3: number; 5: number }>;
}

type Phase = "idle" | "streaming" | "finalizing" | "done" | "error";

/** What research on the topic found on the web and on Threads (lib/ai/research-prompt.ts). */
interface ResearchView {
  queries: string[];
  brief: string | null;
  sources: { title: string; url: string; date: string | null }[];
  conversation: string | null;
  threads: { username: string; permalink: string | null; date: string | null }[];
}

interface Final {
  /** Streamed index → stored idea (account) or the streamed idea itself (demo). */
  byIndex: Map<number, { id: string | null; idea: IdeaView; status: string }>;
  dropped: number;
  charged: number;
  research: ResearchView | null;
}

const ERRORS: Record<string, string> = {
  insufficient_credits: "You don't have enough credits for this batch.",
  insufficient_credits_recharging: "You're low on credits. Auto-recharge is topping you up now; try again in a moment.",
  byok_key_invalid: "Your AI Gateway key was rejected, so nothing ran. Replace it, or switch back to credits.",
  byok_no_balance: "Your AI Gateway account is out of funds. Add funds in Vercel, or switch back to credits.",
  rate_limited: "That's a lot of ideas in a short time. Give it a few minutes, then try again.",
  ai_unavailable: "AI generation isn't set up on this deployment yet.",
  not_signed_in: "Your session ended. Sign in again to keep generating.",
};

const TIER_LABEL = { fast: "Fast", balanced: "Balanced", best: "Best" } as const;

class GenerateError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const completeSlot = (slot: IdeaView["bestSlot"]) =>
  slot?.weekday !== undefined && slot.hour !== undefined ? { weekday: slot.weekday, hour: slot.hour } : null;

const normalize = (text: string) => text.trim().replace(/\n{3,}/g, "\n\n");

export function Studio({
  author,
  goal,
  demo,
  byok,
  models,
  initialModelId,
  voicePosts = null,
  researchCredits = null,
  threadsSearch = "off",
  initialSpice = "bold",
}: {
  author: PostAuthor;
  goal: Goal;
  demo: boolean;
  byok: boolean;
  models: StudioModel[];
  initialModelId: string;
  /** Posts the author's Profile DNA was learned from, once there is one. */
  voicePosts?: number | null;
  /** Typical credits for a topic's research; null when there's no research (demo, or no model for it). */
  researchCredits?: number | null;
  /** Whether research also reads Threads posts on the topic, or would after reconnecting (lib/ai/threads-search.ts). */
  threadsSearch?: "on" | "reconnect" | "off";
  /** The tone to start on (Settings → Voice). */
  initialSpice?: SpiceLevel;
}) {
  const router = useRouter();
  const composer = useComposer();
  const [topic, setTopic] = useState("");
  const [spice, setSpice] = useState<SpiceLevel>(initialSpice);
  const [shape, setShape] = useState<IdeaShape>("post");
  const [format, setFormat] = useState<GenerateRequest["format"]>("any");
  const [count, setCount] = useState<"3" | "5">("3");
  const [modelId, setModelId] = useState(initialModelId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [final, setFinal] = useState<Final | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  /** The batch being written, for the progress timeline (lib/ai/progress.ts). */
  const [batch, setBatch] = useState<{
    /** The topic researched before writing, if any. */
    topic: string | null;
    shape: IdeaShape;
    count: number;
    responded: boolean;
    context: BatchContext | null;
    wrote: number | null;
  } | null>(null);
  const meta = useRef<{ generationId: string | null; demo: boolean }>({ generationId: null, demo: false });
  const results = useRef<HTMLElement>(null);

  const model = models.find((x) => x.modelId === modelId) ?? models[0];
  const researches = !demo && researchCredits !== null && topic.trim() !== "";
  const estimate = (model?.credits[shape][count === "5" ? 5 : 3] ?? 0) + (researches ? (researchCredits ?? 0) : 0);

  async function finalize(streamed: IdeaView[]) {
    if (meta.current.demo || !meta.current.generationId) {
      setFinal({
        byIndex: new Map(streamed.map((idea, i) => [i, { id: null, idea, status: "new" }])),
        dropped: 0,
        charged: 0,
        research: null,
      });
      setPhase("done");
      return;
    }
    setPhase("finalizing");
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(`/api/generations/${meta.current.generationId}`, { cache: "no-store" });
      if (response.ok) {
        const result = (await response.json()) as {
          status: string;
          dropped: number;
          creditsCharged: number;
          error: string | null;
          research: ResearchView | null;
          suggestions: StoredSuggestion[];
        };
        if (result.status !== "running") {
          const byIndex: Final["byIndex"] = new Map();
          const remaining = [...result.suggestions];
          streamed.forEach((idea, i) => {
            const match = remaining.findIndex((s) => s.text === normalize(idea.text ?? ""));
            if (match >= 0) {
              const [stored] = remaining.splice(match, 1);
              byIndex.set(i, { id: stored.id, idea: stored, status: stored.status });
            }
          });
          setFinal({ byIndex, dropped: result.dropped, charged: result.creditsCharged, research: result.research });
          setPhase(result.status === "done" ? "done" : "error");
          if (result.status !== "done") setErrorCode(result.error ?? "failed");
          // Refresh the header balance and Home's plays.
          router.refresh();
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    setPhase("error");
    setErrorCode("failed");
  }

  const { object, submit, isLoading, stop } = useObject({
    api: "/api/generate",
    schema: suggestionBatchSchema,
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      const context = readContextHeader(response.headers.get(CONTEXT_HEADER));
      setBatch((current) => current && { ...current, responded: response.ok, context });
      meta.current = {
        generationId: response.headers.get("x-generation-id"),
        demo: response.headers.get("x-threaded-demo") === "1",
      };
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; recharging?: boolean };
        throw new GenerateError(body.recharging ? `${body.error}_recharging` : (body.error ?? "failed"));
      }
      return response;
    },
    onFinish: async ({ object: done, error }) => {
      if (error || !done) {
        setPhase("error");
        setErrorCode("failed");
        return;
      }
      setBatch((current) => current && { ...current, wrote: done.suggestions.length });
      await finalize(done.suggestions);
    },
    onError: (error) => {
      setPhase("error");
      setErrorCode(error instanceof GenerateError ? error.code : "failed");
    },
  });

  function generate() {
    setPhase("streaming");
    setErrorCode(null);
    setFinal(null);
    setHidden(new Set());
    setBatch({
      topic: researches ? topic.trim() : null,
      shape,
      count: Number(count),
      responded: false,
      context: null,
      wrote: null,
    });
    const request: Partial<GenerateRequest> = {
      goal,
      spice,
      shape,
      format,
      count: Number(count),
      modelId,
      ...(topic.trim() ? { topic: topic.trim() } : {}),
    };
    submit(request);
    // On small screens the ideas appear below the controls; bring them into view.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      results.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  }

  async function changeModel(next: string) {
    setModelId(next);
    if (!demo) await setModelPickAction("generate", next);
  }

  /** Records a status the server already applied (scheduled or posted) on the card. */
  function markLocally(index: number, status: string) {
    setFinal((f) => {
      const entry = f?.byIndex.get(index);
      if (!f || !entry) return f;
      const byIndex = new Map(f.byIndex);
      byIndex.set(index, { ...entry, status });
      return { ...f, byIndex };
    });
  }

  async function setStatus(index: number, status: "saved" | "new" | "dismissed") {
    const entry = final?.byIndex.get(index);
    if (!entry) return;
    if (status === "dismissed") setHidden((h) => new Set(h).add(index));
    setFinal((f) => {
      if (!f) return f;
      const byIndex = new Map(f.byIndex);
      byIndex.set(index, { ...entry, status });
      return { ...f, byIndex };
    });
    if (entry.id) {
      await setSuggestionStatusAction(entry.id, status);
      router.refresh();
    }
  }

  const streamed = (object?.suggestions ?? []) as IdeaView[];
  const busy = phase === "streaming" || phase === "finalizing" || isLoading;

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="h-fit p-5 lg:sticky lg:top-6">
        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) generate();
          }}
        >
          <div>
            <p className="text-sm text-subtle">Writing for</p>
            <p className="font-semibold text-accent">{GOAL_META[goal].label}</p>
            {voicePosts !== null && (
              <p className="mt-1 text-subtle text-xs">
                In your voice, learned from {voicePosts} of your posts ·{" "}
                <Link href="/settings#voice" className="underline underline-offset-2 hover:text-fg">
                  Voice settings
                </Link>
              </p>
            )}
          </div>

          <div>
            <label className="block">
              <span className="mb-1.5 block font-medium text-sm">Topic</span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={120}
                placeholder="Anything in your niche, or leave blank"
                aria-describedby={!demo && researchCredits !== null ? "topic-hint" : undefined}
                className="h-10 w-full rounded-xl border border-border-strong bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle focus-visible:border-accent"
              />
            </label>
            {!demo && researchCredits !== null && (
              <p id="topic-hint" className="mt-1.5 text-subtle text-xs leading-relaxed">
                {threadsSearch === "on"
                  ? "Threaded reads what's popular on Threads about it first, and checks the web when you name something specific, like a tool or this week's news"
                  : "Name something specific, like a tool or this week's news, and Threaded checks the web first"}
                {byok ? "." : ` (≈${researchCredits} cr).`}
                {threadsSearch === "reconnect" && (
                  <>
                    {" "}
                    To read what's popular on Threads about it too,{" "}
                    <a href="/api/auth/threads/start" className="text-accent underline underline-offset-2">
                      reconnect Threads
                    </a>
                    .
                  </>
                )}
              </p>
            )}
          </div>

          <div>
            <span className="mb-1.5 block font-medium text-sm">Tone</span>
            <Segmented
              legend="Tone"
              options={SPICE_LEVELS.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))}
              value={spice}
              onChange={setSpice}
            />
          </div>

          {!demo && (
            <div>
              <span className="mb-1.5 block font-medium text-sm">Each idea is</span>
              <Segmented
                legend="Each idea is"
                options={[
                  { value: "post", label: "One post" },
                  { value: "thread", label: "A thread" },
                ]}
                value={shape}
                onChange={setShape}
              />
              {shape === "thread" && (
                <p className="mt-1.5 text-subtle text-xs leading-relaxed">
                  3 to 5 posts, each a reply to the one before. Longer, so it costs a little more.
                </p>
              )}
            </div>
          )}

          <div className="flex gap-4">
            <label className="block flex-1">
              <span className="mb-1.5 block font-medium text-sm">Format</span>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as GenerateRequest["format"])}
                className="h-10 w-full rounded-xl border border-border-strong bg-surface-2 px-2 text-sm outline-none focus-visible:border-accent"
              >
                <option value="any">Any</option>
                {POST_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="mb-1.5 block font-medium text-sm">Ideas</span>
              <Segmented
                legend="Number of ideas"
                options={[
                  { value: "3", label: "3" },
                  { value: "5", label: "5" },
                ]}
                value={count}
                onChange={setCount}
              />
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block font-medium text-sm">Model</span>
            <select
              value={modelId}
              onChange={(e) => changeModel(e.target.value)}
              className="h-10 w-full rounded-xl border border-border-strong bg-surface-2 px-2 text-sm outline-none focus-visible:border-accent"
            >
              {models.map((x) => (
                <option key={x.modelId} value={x.modelId}>
                  {x.label} · {TIER_LABEL[x.tier]}
                  {byok || demo ? "" : ` · ≈${x.credits[shape][count === "5" ? 5 : 3]} cr`}
                </option>
              ))}
            </select>
          </label>

          <div className="relative">
            {busy ? (
              <Button type="button" variant="outline" className="w-full" onClick={() => stop()}>
                <Square /> Stop
              </Button>
            ) : (
              <Button type="submit" size="lg" className="w-full">
                <Sparkles />
                Generate
                <span className="ml-auto font-mono text-xs opacity-80">
                  {demo ? "Free in demo" : byok ? "Your key" : `≈${estimate} cr`}
                </span>
              </Button>
            )}
            <AnimatePresence>
              {phase === "done" && final && final.charged > 0 && (
                <m.span
                  key="charged"
                  className="pointer-events-none absolute -top-2 right-3 font-mono font-semibold text-accent text-sm"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: [0, 1, 1, 0], y: -24 }}
                  transition={{ duration: 1.8, times: [0, 0.15, 0.7, 1] }}
                >
                  −{final.charged} cr
                </m.span>
              )}
            </AnimatePresence>
          </div>
          {!demo && !byok && (
            <p className="text-subtle text-xs leading-relaxed">
              You're charged the actual cost after it runs, never more than shown at the start, and nothing if no ideas
              come back.
            </p>
          )}
        </form>
      </Card>

      <section ref={results} aria-label="Ideas" aria-live="polite" className="min-w-0 scroll-mt-4">
        {phase === "idle" && streamed.length === 0 && <EmptyStudio goal={goal} />}

        {batch && phase !== "idle" && (
          <ProgressTimeline
            steps={progressSteps({
              ...batch,
              phase,
              threadsSearch: threadsSearch === "on",
              streamed: streamed.length,
              checks: !demo,
              outcome: final ? { kept: final.byIndex.size, dropped: final.dropped } : null,
            })}
          />
        )}

        {phase === "error" && (
          <Card className="mb-4 flex items-start gap-3 border-negative/30 bg-negative/5 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-negative" aria-hidden />
            <div className="space-y-3">
              <p>{ERRORS[errorCode ?? ""] ?? "Something went wrong and you haven't been charged. Please try again."}</p>
              <ErrorActions code={errorCode} onSwitched={() => router.refresh()} />
            </div>
          </Card>
        )}

        <div className="grid gap-4">
          <AnimatePresence initial={false} mode="popLayout">
            {streamed.map((idea, index) => {
              const settled = final?.byIndex.get(index);
              if (final && !settled) return null; // dropped in post-processing
              if (hidden.has(index)) return null;
              return (
                <IdeaCard
                  // biome-ignore lint/suspicious/noArrayIndexKey: streamed ideas have no id until they're stored
                  key={index}
                  author={author}
                  idea={settled?.idea ?? idea}
                  streaming={!settled}
                  saved={settled?.status === "saved"}
                  queued={settled?.status === "scheduled" || settled?.status === "posted" ? settled.status : undefined}
                  onToggleSave={
                    settled ? () => setStatus(index, settled.status === "saved" ? "new" : "saved") : undefined
                  }
                  onDismiss={settled ? () => setStatus(index, "dismissed") : undefined}
                  onCompose={
                    composer && settled?.id
                      ? (mode) =>
                          composer.open({
                            text: settled.idea.text ?? "",
                            seriesParts: (settled.idea.parts ?? []).filter((part): part is string => Boolean(part)),
                            suggestionId: settled.id,
                            ideaSlot: completeSlot(settled.idea.bestSlot),
                            mode,
                            // "Post now" may still fail, so the card says it's queued either way.
                            onQueued: () => markLocally(index, "scheduled"),
                          })
                      : undefined
                  }
                />
              );
            })}
          </AnimatePresence>
        </div>

        {final?.research && <ThreadsNote research={final.research} />}
        {final?.research && <ResearchNote research={final.research} />}

        {final && final.dropped > 0 && (
          <p className="mt-3 text-subtle text-xs">
            {final.dropped === 1 ? "1 idea was" : `${final.dropped} ideas were`} left out for repeating a post (yours or
            one on Threads), going against your{" "}
            <Link href="/settings#voice" className="underline underline-offset-2 hover:text-fg">
              voice settings
            </Link>{" "}
            or running too long.
          </p>
        )}
      </section>
    </div>
  );
}

const hostname = (url: string) => new URL(url).hostname.replace(/^www\./, "");

function sourceDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** What popular Threads posts on the topic are saying, with links to the posts it read. */
function ThreadsNote({ research }: { research: ResearchView }) {
  if (!research.conversation) return null;
  return (
    <Card role="region" className="mt-4 p-4" aria-label="On Threads">
      <p className="flex items-center gap-2 font-medium text-sm">
        <AtSign className="size-4 text-accent" aria-hidden /> What people on Threads are saying
      </p>
      <p className="mt-2 text-muted text-sm leading-relaxed">{research.conversation}</p>
      <p className="mt-3 text-subtle text-xs">
        From{" "}
        {research.threads.length === 1 ? "1 recent popular post" : `${research.threads.length} recent popular posts`}:
      </p>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {research.threads.map((post, i) => {
          const label = `@${post.username}${sourceDate(post.date) ? ` · ${sourceDate(post.date)}` : ""}`;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a username can appear twice, and a post may have no link
            <li key={i} className="min-w-0">
              {post.permalink?.startsWith("https://") ? (
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-accent hover:underline"
                >
                  {label}
                </a>
              ) : (
                <span className="text-subtle">{label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** What the batch's web search found, so the ideas can be checked against it. */
function ResearchNote({ research }: { research: ResearchView }) {
  const query = research.queries[0];
  if (!query) return null;
  if (!research.brief) {
    return (
      <p className="mt-4 flex items-start gap-2 text-subtle text-xs">
        <Globe className="mt-px size-3.5 shrink-0" aria-hidden />
        Threaded searched the web for “{query}” but found nothing reliable, so these ideas don't assume what it is.
      </p>
    );
  }
  return (
    <Card role="region" className="mt-4 p-4" aria-label="From the web">
      <p className="flex items-center gap-2 font-medium text-sm">
        <Globe className="size-4 text-accent" aria-hidden /> From a web search for “{query}”
      </p>
      <p className="mt-2 text-muted text-sm leading-relaxed">{research.brief}</p>
      <ul className="mt-3 grid gap-1.5 text-sm">
        {research.sources.map((source) => (
          <li key={source.url} className="min-w-0">
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-accent hover:underline"
            >
              {source.title}
            </a>
            <span className="text-subtle text-xs">
              {" "}
              · {hostname(source.url)}
              {sourceDate(source.date) ? ` · ${sourceDate(source.date)}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The fix for an error the user can act on: buy credits, or leave a broken key. */
function ErrorActions({ code, onSwitched }: { code: string | null; onSwitched: () => void }) {
  if (code === "insufficient_credits") {
    return (
      <Button asChild size="sm">
        <Link href="/settings/billing">Buy credits</Link>
      </Button>
    );
  }
  if (code === "byok_key_invalid" || code === "byok_no_balance") {
    return (
      <div className="flex flex-wrap gap-2">
        <form
          action={async () => {
            await switchToCreditsAction();
            onSwitched();
          }}
        >
          <Button type="submit" size="sm">
            Switch to credits
          </Button>
        </form>
        <Button asChild size="sm" variant="ghost">
          <Link href="/settings/billing">Billing</Link>
        </Button>
      </div>
    );
  }
  return null;
}

function EmptyStudio({ goal }: { goal: Goal }) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-accent/15 text-accent">
        <Sparkles className="size-6" aria-hidden />
      </span>
      <h2 className="mt-5 font-semibold text-lg">Ideas in your voice, for {GOAL_META[goal].label.toLowerCase()}</h2>
      <p className="mt-2 max-w-md text-muted text-sm leading-relaxed">
        Threaded studies your best posts, then writes new ones that sound like you. Each idea explains why it should
        work, using your own numbers.
      </p>
    </Card>
  );
}
