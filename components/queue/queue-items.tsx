"use client";

import { CalendarClock, ExternalLink, LoaderCircle, RotateCw, Send, TriangleAlert, X } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useComposer } from "@/components/composer/provider";
import { uiSpring } from "@/components/motion/springs";
import { type PostAuthor, PostPreview } from "@/components/threads/post-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cancelPostAction, retryPostAction } from "@/lib/actions/publishing";
import type { QueuedPost } from "@/lib/data/queue";
import { formatMetric } from "@/lib/format";

/** A post waiting to go out (its time sits beside it on the timeline): edit it, post it now, or cancel it. */
export function ScheduledItem({ author, post }: { author: PostAuthor; post: QueuedPost }) {
  const composer = useComposer();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const publishing = post.status === "publishing";
  const edit = (mode: "schedule" | "now") =>
    composer?.open({
      text: post.text,
      topicTag: post.topicTag,
      postId: post.id,
      scheduledFor: post.scheduledFor,
      mode,
    });

  return (
    <Card className="p-4">
      <PostPreview
        author={author}
        text={post.text}
        clamp={4}
        meta={
          publishing ? (
            <Badge variant="accent">
              <LoaderCircle className="animate-spin" /> Publishing
            </Badge>
          ) : (
            post.topicTag && <span className="text-xs">#{post.topicTag}</span>
          )
        }
      />
      {!publishing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-border border-t pt-3">
          <AnimatePresence mode="wait" initial={false}>
            {confirming ? (
              <m.div
                key="confirm"
                className="flex flex-wrap items-center gap-2"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={uiSpring}
              >
                <span className="text-sm">Take this out of the queue?</span>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep it
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await cancelPostAction(post.id);
                      if (!result.ok) setMessage(result.message ?? null);
                      setConfirming(false);
                      router.refresh();
                    })
                  }
                >
                  {pending && <LoaderCircle className="animate-spin" />} Yes, cancel it
                </Button>
              </m.div>
            ) : (
              <m.div
                key="actions"
                className="flex flex-wrap gap-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <Button size="sm" variant="outline" onClick={() => edit("schedule")}>
                  <CalendarClock /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={() => edit("now")}>
                  <Send /> Post now
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                  <X /> Cancel
                </Button>
              </m.div>
            )}
          </AnimatePresence>
          {message && <p className="w-full text-negative text-sm">{message}</p>}
        </div>
      )}
    </Card>
  );
}

/** A post that didn't go out, with why, and the fixes. */
export function FailedItem({ author, post, time }: { author: PostAuthor; post: QueuedPost; time: string }) {
  const composer = useComposer();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const act = (action: () => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result.ok ? null : (result.message ?? null));
      router.refresh();
    });

  return (
    <Card className="border-negative/30 p-4">
      <p className="mb-3 flex items-start gap-2 text-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-negative" aria-hidden />
        <span>
          <span className="font-medium">Didn't post {time}.</span> {post.lastError}
        </span>
      </p>
      <PostPreview author={author} text={post.text} clamp={3} />
      <div className="mt-3 flex flex-wrap gap-2 border-border border-t pt-3">
        <Button size="sm" disabled={pending} onClick={() => act(() => retryPostAction(post.id))}>
          {pending ? <LoaderCircle className="animate-spin" /> : <RotateCw />} Retry now
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            composer?.open({ text: post.text, topicTag: post.topicTag, postId: post.id, mode: "schedule" })
          }
        >
          <CalendarClock /> Edit and reschedule
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => cancelPostAction(post.id))}>
          <X /> Remove
        </Button>
      </div>
      {message && <p className="mt-2 text-negative text-sm">{message}</p>}
    </Card>
  );
}

/** A post that went out through Threaded, with its latest numbers. */
export function PostedItem({ author, post, time }: { author: PostAuthor; post: QueuedPost; time: string }) {
  return (
    <Card className="p-4">
      <PostPreview author={author} text={post.text} clamp={2} meta={<span className="text-xs">{time}</span>} />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-t pt-3 text-sm">
        {post.metrics ? (
          <span className="text-muted">
            {formatMetric(post.metrics.views, "compact")} views · {formatMetric(post.metrics.likes, "compact")} likes ·{" "}
            {formatMetric(post.metrics.replies, "compact")} replies
          </span>
        ) : (
          <span className="text-subtle">First numbers arrive about an hour after posting.</span>
        )}
        {post.permalink && (
          <a
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"
          >
            View on Threads <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </Card>
  );
}
