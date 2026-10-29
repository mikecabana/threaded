"use client";

import { CalendarClock, Check, ExternalLink, LoaderCircle, Plus, Send, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { revealSpring, uiSpring } from "@/components/motion/springs";
import { SeriesPreview } from "@/components/threads/series-preview";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { type ComposeResult, schedulePostAction, updatePostAction } from "@/lib/actions/publishing";
import { DRAFT_PROBLEMS, MAX_SERIES_PARTS, seriesProblem, TOPIC_TAG_MAX } from "@/lib/publishing/draft";
import { fromLocalInput, type Slot, slotLabel, suggestedSlots, toLocalInput } from "@/lib/publishing/slots";
import { threadsLength } from "@/lib/threads/length";
import { cn } from "@/lib/utils";
import { CounterRing } from "./counter-ring";
import type { ComposerConfig, ComposerDraft } from "./provider";

type Mode = "schedule" | "now";
type Stage =
  | { kind: "editing" }
  | { kind: "confirming" }
  | { kind: "sending" }
  | { kind: "publishing"; id: string }
  | { kind: "scheduled"; label: string }
  | { kind: "published"; permalink: string | null }
  | { kind: "failed"; message: string };

const CUSTOM = "custom";
const HOUR = 3_600_000;

/** An hour from now on the hour, as a starting point for a custom time. */
function defaultCustom(timeZone: string) {
  return toLocalInput(new Date(Math.ceil((Date.now() + HOUR) / HOUR) * HOUR), timeZone);
}

/**
 * The composer: write or polish a post with a live Threads preview, then
 * schedule it into one of your best slots (or any time), or post it now
 * after a confirmation. Nothing is posted without that explicit step. "Add to
 * thread" turns it into a series: each part goes out as a reply to the one
 * before, the way Threads chains them.
 */
export function Composer({
  config,
  draft,
  onClose,
}: {
  config: ComposerConfig;
  draft: ComposerDraft;
  onClose: () => void;
}) {
  const router = useRouter();
  const reduce = useReducedMotion();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const editing = Boolean(draft.postId);

  const nextKey = useRef(0);
  const part = (text: string) => ({ key: String(nextKey.current++), text });
  const [parts, setParts] = useState(() => [draft.text, ...(draft.seriesParts ?? [])].map(part));
  const [added, setAdded] = useState<string | null>(null);
  const [topic, setTopic] = useState(draft.topicTag ?? "");
  const [mode, setMode] = useState<Mode>(draft.mode ?? "schedule");
  const [stage, setStage] = useState<Stage>({ kind: "editing" });
  const [error, setError] = useState<string | null>(null);

  // Slots are relative to when the composer opened.
  const opened = useMemo(() => new Date(), []);
  const slots: Slot[] = useMemo(
    () =>
      suggestedSlots({ bestHours: config.bestHours, ideaSlot: draft.ideaSlot, timeZone: config.timeZone, now: opened }),
    [config.bestHours, config.timeZone, draft.ideaSlot, opened],
  );
  const [slot, setSlot] = useState<string>(draft.scheduledFor ? CUSTOM : (slots[0]?.at ?? CUSTOM));
  const [custom, setCustom] = useState(() =>
    draft.scheduledFor ? toLocalInput(new Date(draft.scheduledFor), config.timeZone) : defaultCustom(config.timeZone),
  );

  const texts = parts.map((p) => p.text);
  const series = parts.length > 1;
  const found = seriesProblem(texts, topic);
  const problem =
    found && (series ? `Part ${found.part}: ${DRAFT_PROBLEMS[found.problem]}` : DRAFT_PROBLEMS[found.problem]);
  const busy = stage.kind === "sending" || stage.kind === "publishing";
  const customAt = fromLocalInput(custom, config.timeZone);
  const when =
    slot === CUSTOM
      ? customAt && slotLabel(customAt, config.timeZone, opened)
      : slots.find((s) => s.at === slot)?.label;

  // Modal behaviour (focus trap, inert page, Escape) comes from the native dialog.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = "";
      previous?.focus?.();
    };
  }, []);

  // After "Post now", follow the publish run until it lands (a series takes a little longer per part).
  const patience = 90_000 + 60_000 * (parts.length - 1);
  useEffect(() => {
    if (stage.kind !== "publishing") return;
    let cancelled = false;
    const started = Date.now();
    const poll = async () => {
      while (!cancelled && Date.now() - started < patience) {
        const response = await fetch(`/api/posts/${stage.id}`, { cache: "no-store" }).catch(() => null);
        const post = (await response?.json().catch(() => null)) as {
          status: string;
          permalink: string | null;
          lastError: string | null;
        } | null;
        if (post?.status === "published") {
          if (!cancelled) setStage({ kind: "published", permalink: post.permalink });
          router.refresh();
          return;
        }
        if (post?.status === "failed") {
          if (!cancelled) setStage({ kind: "failed", message: post.lastError ?? "Threads didn't accept the post." });
          router.refresh();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!cancelled) {
        setStage({ kind: "failed", message: "This is taking longer than usual. It will show up in your Queue." });
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [stage, router, patience]);

  function close() {
    if (busy) return;
    onClose();
  }

  function setPartText(key: string, text: string) {
    setParts((current) => current.map((p) => (p.key === key ? { ...p, text } : p)));
  }

  function addPart() {
    const next = part("");
    setParts((current) => [...current, next]);
    setAdded(next.key);
  }

  async function submit(now: boolean) {
    if (problem) return setError(problem);
    setError(null);
    setStage({ kind: "sending" });
    const payload = {
      text: texts[0],
      topicTag: topic.trim() || undefined,
      seriesParts: series ? texts.slice(1) : undefined,
      suggestionId: draft.suggestionId ?? undefined,
      when: now
        ? { kind: "now" as const }
        : slot === CUSTOM
          ? { kind: "local" as const, value: custom }
          : { kind: "at" as const, iso: slot },
    };
    let result: ComposeResult;
    try {
      result = draft.postId ? await updatePostAction(draft.postId, payload) : await schedulePostAction(payload);
    } catch {
      result = { ok: false, message: "Couldn't reach Threaded. Check your connection and try again." };
    }
    if (!result.ok) {
      setStage({ kind: "editing" });
      setError(result.message);
      return;
    }
    draft.onQueued?.({ id: result.id, scheduledFor: result.scheduledFor, mode: now ? "now" : "schedule" });
    if (now) {
      setStage({ kind: "publishing", id: result.id });
    } else {
      setStage({
        kind: "scheduled",
        label: slotLabel(new Date(result.scheduledFor), config.timeZone, new Date()),
      });
      router.refresh();
    }
  }

  const sheet = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.98 },
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape: close with the exit animation (or not at all while sending).
        event.preventDefault();
        close();
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-0 text-fg backdrop:bg-transparent"
    >
      <m.div
        aria-hidden
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={close}
      />
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-6">
        <m.div
          {...sheet}
          transition={uiSpring}
          className="pointer-events-auto flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-bg shadow-2xl sm:max-w-3xl sm:rounded-3xl"
        >
          <header className="flex items-center justify-between gap-3 border-border border-b px-5 py-4">
            <h2 id={titleId} className="font-semibold text-lg">
              {editing ? "Edit scheduled post" : "New post"}
            </h2>
            <button
              type="button"
              onClick={close}
              disabled={busy}
              aria-label="Close"
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:opacity-40"
            >
              <X className="size-5" />
            </button>
          </header>

          <AnimatePresence mode="wait" initial={false}>
            {stage.kind === "scheduled" || stage.kind === "published" || stage.kind === "publishing" ? (
              <Outcome key="outcome" stage={stage} onClose={close} username={config.author.username} series={series} />
            ) : stage.kind === "failed" ? (
              <Outcome key="failed" stage={stage} onClose={close} username={config.author.username} series={series} />
            ) : (
              <m.div
                key="form"
                className="flex min-h-0 flex-1 flex-col"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-2">
                  <div className="space-y-4">
                    {parts.map((p, index) => (
                      <div key={p.key} className="space-y-3">
                        <label className="block">
                          <span className={series ? "mb-1.5 block font-medium text-subtle text-xs" : "sr-only"}>
                            {index === 0 ? "Post text" : `Part ${index + 1} text`}
                          </span>
                          <textarea
                            value={p.text}
                            onChange={(e) => setPartText(p.key, e.target.value)}
                            rows={series ? 4 : 8}
                            autoFocus={index === 0 || p.key === added}
                            className={cn(
                              "w-full resize-none rounded-2xl border border-border-strong bg-surface-2 p-3 text-[15px] leading-relaxed outline-none focus-visible:border-accent",
                              series ? "h-28" : "h-36 sm:h-56",
                            )}
                          />
                        </label>
                        <div className="flex items-center gap-3">
                          {index === 0 ? (
                            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border-strong bg-surface-2 px-3">
                              <span className="text-subtle text-sm">#</span>
                              <input
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                maxLength={TOPIC_TAG_MAX + 1}
                                placeholder="Topic tag (optional)"
                                aria-label="Topic tag"
                                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle"
                              />
                            </label>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setParts((current) => current.filter((other) => other.key !== p.key))}
                              className="mr-auto flex items-center gap-1 rounded-lg px-2 py-1 text-muted text-sm transition-colors hover:bg-surface-2 hover:text-fg"
                            >
                              <X className="size-4" aria-hidden /> Remove part {index + 1}
                            </button>
                          )}
                          <CounterRing length={threadsLength(p.text)} />
                        </div>
                      </div>
                    ))}
                    {parts.length < MAX_SERIES_PARTS && (
                      <button
                        type="button"
                        onClick={addPart}
                        className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 font-medium text-accent text-sm transition-colors hover:bg-accent/10"
                      >
                        <Plus className="size-4" aria-hidden /> Add to thread
                      </button>
                    )}
                  </div>
                  <div>
                    <p className="mb-2 font-medium text-subtle text-xs uppercase tracking-wide">Preview</p>
                    <div className="rounded-2xl border border-border bg-surface p-4">
                      <SeriesPreview
                        author={config.author}
                        parts={parts}
                        meta={topic.trim() ? <span className="text-xs">#{topic.trim().replace(/^#/, "")}</span> : null}
                      />
                    </div>
                    {series && (
                      <p className="mt-2 text-subtle text-xs">
                        Each part goes out as a reply to the one before, so they read as one thread.
                      </p>
                    )}
                  </div>
                </div>

                <footer className="space-y-4 border-border border-t p-5">
                  <Segmented
                    legend="When"
                    options={[
                      { value: "schedule", label: "Schedule" },
                      { value: "now", label: "Post now" },
                    ]}
                    value={mode}
                    onChange={(next) => {
                      setMode(next);
                      setStage({ kind: "editing" });
                    }}
                  />

                  {mode === "schedule" ? (
                    <SlotPicker
                      slots={slots}
                      value={slot}
                      onChange={setSlot}
                      custom={custom}
                      onCustom={setCustom}
                      timeZone={config.timeZone}
                    />
                  ) : (
                    <p className="text-muted text-sm">
                      Publishes to <span className="font-medium text-fg">@{config.author.username}</span> right away.
                    </p>
                  )}

                  {error && (
                    <p role="alert" className="flex items-start gap-2 text-negative text-sm">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {stage.kind === "confirming" ? (
                      <m.div
                        className="flex flex-wrap items-center justify-end gap-2"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={revealSpring}
                      >
                        <span className="font-medium text-sm">
                          {series ? `Post these ${parts.length} parts to Threads now?` : "Post this to Threads now?"}
                        </span>
                        <Button variant="ghost" onClick={() => setStage({ kind: "editing" })}>
                          Not yet
                        </Button>
                        <Button onClick={() => submit(true)}>
                          <Send /> Yes, post it
                        </Button>
                      </m.div>
                    ) : mode === "now" ? (
                      <Button
                        onClick={() => (problem ? setError(problem) : setStage({ kind: "confirming" }))}
                        disabled={busy}
                      >
                        {busy ? <LoaderCircle className="animate-spin" /> : <Send />} Post now
                      </Button>
                    ) : (
                      <Button onClick={() => submit(false)} disabled={busy || !when}>
                        {busy ? <LoaderCircle className="animate-spin" /> : <CalendarClock />}
                        {editing ? "Save changes" : when ? `Schedule for ${when}` : "Schedule"}
                      </Button>
                    )}
                  </div>
                </footer>
              </m.div>
            )}
          </AnimatePresence>
        </m.div>
      </div>
    </dialog>
  );
}

function SlotPicker({
  slots,
  value,
  onChange,
  custom,
  onCustom,
  timeZone,
}: {
  slots: Slot[];
  value: string;
  onChange: (value: string) => void;
  custom: string;
  onCustom: (value: string) => void;
  timeZone: string;
}) {
  const name = useId();
  const options = [
    ...slots.map((s) => ({ value: s.at, label: s.label, note: s.note })),
    { value: CUSTOM, label: "Pick a time", note: "" },
  ];
  return (
    <fieldset className="space-y-3">
      <legend className="sr-only">When to post</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span className="flex flex-col rounded-xl border border-border-strong px-3 py-2 text-sm transition-colors peer-checked:border-accent peer-checked:bg-accent/10 peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 hover:border-fg/30">
              <span className="font-medium">{option.label}</span>
              {option.note && <span className="text-subtle text-xs">{option.note}</span>}
            </span>
          </label>
        ))}
      </div>
      {value === CUSTOM && (
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="sr-only">Date and time</span>
          <input
            type="datetime-local"
            value={custom}
            onChange={(e) => onCustom(e.target.value)}
            className="h-10 rounded-xl border border-border-strong bg-surface-2 px-3 text-sm outline-none focus-visible:border-accent"
          />
          <span className="text-subtle text-xs">{timeZone.replace(/_/g, " ")} time</span>
        </label>
      )}
    </fieldset>
  );
}

function Outcome({
  stage,
  onClose,
  username,
  series,
}: {
  stage: Extract<Stage, { kind: "scheduled" | "published" | "publishing" | "failed" }>;
  onClose: () => void;
  username: string;
  series: boolean;
}) {
  const icon =
    stage.kind === "publishing" ? (
      <LoaderCircle className="size-7 animate-spin" aria-hidden />
    ) : stage.kind === "failed" ? (
      <TriangleAlert className="size-7" aria-hidden />
    ) : (
      <Check className="size-7" aria-hidden />
    );
  return (
    <m.div
      className="flex flex-col items-center px-6 py-12 text-center"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={revealSpring}
      role="status"
    >
      <m.span
        className={cn(
          "flex size-14 items-center justify-center rounded-full",
          stage.kind === "failed" ? "bg-negative/15 text-negative" : "bg-accent/15 text-accent",
        )}
        initial={{ scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 14 }}
      >
        {icon}
      </m.span>
      <h3 className="mt-5 font-semibold text-xl">
        {stage.kind === "publishing"
          ? "Posting to Threads…"
          : stage.kind === "published"
            ? `Posted to @${username}`
            : stage.kind === "scheduled"
              ? `Scheduled for ${stage.label}`
              : "That didn't go out"}
      </h3>
      <p className="mt-2 max-w-sm text-muted text-sm">
        {stage.kind === "publishing"
          ? series
            ? "Each part goes out as a reply to the one before. This can take a minute."
            : "This usually takes a few seconds."
          : stage.kind === "published"
            ? "It's live. Threaded will track how it does over the next three days."
            : stage.kind === "scheduled"
              ? "Threaded posts it at that time, even if you're offline. You can change it in your Queue."
              : stage.message}
      </p>
      {stage.kind !== "publishing" && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {stage.kind === "published" && stage.permalink && (
            <Button asChild variant="outline">
              <a href={stage.permalink} target="_blank" rel="noopener noreferrer">
                View on Threads <ExternalLink />
              </a>
            </Button>
          )}
          {stage.kind !== "published" && (
            <Button asChild variant="outline">
              <Link href="/queue" onClick={onClose}>
                Open Queue
              </Link>
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      )}
    </m.div>
  );
}
