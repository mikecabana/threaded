import { CalendarClock, PenLine } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { composerConfig } from "@/components/composer/config";
import { ComposeButton, ComposerProvider } from "@/components/composer/provider";
import { PlayCard } from "@/components/home/play-card";
import { demoSlotLabel } from "@/components/home/side-cards";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { ThreadLine } from "@/components/motion/thread-line";
import { FailedItem, PostedItem, ScheduledItem } from "@/components/queue/queue-items";
import { dayKey, WeekStrip } from "@/components/queue/week-strip";
import { PostPreview } from "@/components/threads/post-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { hourLabel, zonedParts } from "@/lib/analysis/time";
import { type QueuedPost, queueFor } from "@/lib/data/queue";
import { listSuggestions } from "@/lib/data/suggestions";
import { timeAgo } from "@/lib/format";
import { slotLabel } from "@/lib/publishing/slots";
import { type AccountViewer, type DemoViewer, requireViewer } from "@/lib/session/viewer";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <div className="mx-auto max-w-3xl py-4">
      <Suspense fallback={<QueueSkeleton />}>
        <QueueContent />
      </Suspense>
    </div>
  );
}

async function QueueContent() {
  const viewer = await requireViewer();
  return viewer.kind === "demo" ? <DemoQueue viewer={viewer} /> : <AccountQueue viewer={viewer} />;
}

function Header({ action }: { action?: React.ReactNode }) {
  return (
    <Reveal className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">Queue</h1>
        <p className="mt-1 text-muted">Posts go out at their time from Threaded, even when you're offline.</p>
      </div>
      {action}
    </Reveal>
  );
}

/** "7:30 PM" in the profile's timezone. */
function timeOfDay(at: Date, timeZone: string) {
  const p = zonedParts(at, timeZone);
  return p.minute === 0 ? hourLabel(p.hour) : hourLabel(p.hour).replace(" ", `:${String(p.minute).padStart(2, "0")} `);
}

/** Groups posts by local day, labelled "Today", "Tomorrow", "Thu 7 PM"-style. */
function byDay(posts: QueuedPost[], timeZone: string, now: Date) {
  const groups = new Map<string, { label: string; posts: QueuedPost[] }>();
  for (const post of posts) {
    const at = new Date(post.scheduledFor);
    const key = dayKey(at, timeZone);
    const label = slotLabel(at, timeZone, now)
      .replace(/ \d.*$/, "")
      .replace(/,$/, "");
    const group = groups.get(key) ?? { label, posts: [] };
    group.posts.push(post);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

async function AccountQueue({ viewer }: { viewer: AccountViewer }) {
  const { profile, timezone, now } = viewer;
  const [queue, saved] = await Promise.all([
    queueFor(profile.id),
    listSuggestions(profile.id, { statuses: ["saved"], sinceDays: 90, limit: 6 }),
  ]);
  const composer = composerConfig(viewer);
  const author = profile;

  const page = (
    <>
      <Header
        action={
          <ComposeButton draft={{ text: "", mode: "schedule" }} variant="primary" size="md">
            <PenLine /> New post
          </ComposeButton>
        }
      />
      {!composer && (
        <Card className="mb-6 p-4 text-sm">
          Reconnect your Threads account to schedule and publish.{" "}
          <a href="/api/auth/threads/start" className="font-medium text-accent underline underline-offset-2">
            Reconnect
          </a>
        </Card>
      )}

      <WeekStrip scheduled={queue.upcoming.map((p) => new Date(p.scheduledFor))} timeZone={timezone} now={now} />

      {queue.failed.length > 0 && (
        <section aria-labelledby="failed-heading" className="mt-8">
          <h2 id="failed-heading" className="mb-3 font-semibold text-lg">
            Needs attention
          </h2>
          <div className="grid gap-3">
            {queue.failed.map((post) => (
              <FailedItem
                key={post.id}
                author={author}
                post={post}
                time={slotLabel(new Date(post.scheduledFor), timezone, now)}
              />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="scheduled-heading" className="mt-8">
        <h2 id="scheduled-heading" className="mb-3 font-semibold text-lg">
          Scheduled
        </h2>
        {queue.upcoming.length === 0 ? (
          <Card className="flex flex-col items-center px-6 py-10 text-center">
            <span className="flex size-11 items-center justify-center rounded-2xl bg-accent/15 text-accent">
              <CalendarClock className="size-5" aria-hidden />
            </span>
            <p className="mt-4 font-medium">Nothing scheduled</p>
            <p className="mt-1 max-w-sm text-muted text-sm">
              Schedule a saved idea into one of your best hours, or write something new.
            </p>
          </Card>
        ) : (
          <Stagger key={queue.upcoming.map((p) => p.id).join()} className="space-y-6">
            {byDay(queue.upcoming, timezone, now).map(([key, group]) => (
              <StaggerItem key={key}>
                <div id={`day-${key}`} className="scroll-mt-24">
                  <h3 className="mb-2 font-medium text-muted text-sm">{group.label}</h3>
                  <ol className="relative space-y-3">
                    {group.posts.map((post, i) => (
                      <li key={post.id} className="flex gap-3">
                        <div className="flex w-14 shrink-0 flex-col items-center pt-4">
                          <span className="font-medium text-xs tabular">
                            {timeOfDay(new Date(post.scheduledFor), timezone)}
                          </span>
                          {i < group.posts.length - 1 && <ThreadLine className="mt-2 min-h-8 flex-1" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <ScheduledItem author={author} post={post} />
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </section>

      {saved.length > 0 && (
        <section aria-labelledby="queue-saved-heading" className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="queue-saved-heading" className="font-semibold text-lg">
              Saved ideas
            </h2>
            <Button asChild variant="ghost" size="sm">
              <Link href="/studio">Write more in Studio</Link>
            </Button>
          </div>
          <div className="grid gap-3">
            {saved.map((idea) => (
              <PlayCard key={idea.id} author={author} play={idea} suggestionId={idea.id} />
            ))}
          </div>
        </section>
      )}

      {queue.posted.length > 0 && (
        <section aria-labelledby="posted-heading" className="mt-10">
          <h2 id="posted-heading" className="mb-3 font-semibold text-lg">
            Posted with Threaded
          </h2>
          <div className="grid gap-3">
            {queue.posted.map((post) => (
              <PostedItem
                key={post.id}
                author={author}
                post={post}
                time={timeAgo(post.publishedAt ?? post.scheduledFor, now)}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
  return composer ? <ComposerProvider config={composer}>{page}</ComposerProvider> : page;
}

/** The demo shows a sample of what the Queue looks like; scheduling needs a real account. */
function DemoQueue({ viewer }: { viewer: DemoViewer }) {
  const { persona, profile } = viewer;
  return (
    <>
      <Header />
      <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <span>This is a sample queue. Connect your Threads account to schedule and publish real posts.</span>
        <Button asChild size="sm">
          <Link href="/connect">Connect Threads</Link>
        </Button>
      </Card>
      <section aria-labelledby="scheduled-heading">
        <h2 id="scheduled-heading" className="mb-3 flex items-center gap-2 font-semibold text-lg">
          Scheduled <Badge>Sample</Badge>
        </h2>
        <Card className="p-4">
          <PostPreview
            author={profile}
            text={persona.upNext.text}
            clamp={4}
            meta={<span className="font-medium text-fg text-xs">{demoSlotLabel(persona.upNext)}</span>}
          />
        </Card>
      </section>
      <section aria-labelledby="queue-saved-heading" className="mt-10">
        <h2 id="queue-saved-heading" className="mb-3 font-semibold text-lg">
          Saved ideas
        </h2>
        <div className="grid gap-3">
          {persona.suggestions[viewer.goal].slice(0, 2).map((play) => (
            <PlayCard key={play.text} author={profile} play={play} />
          ))}
        </div>
      </section>
    </>
  );
}

function QueueSkeleton() {
  return (
    <div aria-busy>
      <Skeleton className="mb-2 h-8 w-40" />
      <Skeleton className="mb-6 h-5 w-80 max-w-full" />
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 7 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-8 h-40 rounded-2xl" />
      <Skeleton className="mt-3 h-40 rounded-2xl" />
    </div>
  );
}
