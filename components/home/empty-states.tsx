import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/motion/reveal";
import { ThreadLine } from "@/components/motion/thread-line";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GOAL_META, type Goal } from "@/lib/goals";
import type { Viewer } from "@/lib/session/viewer";

/** Home before the first sync has brought in any posts. */
export function FirstSync({ firstName, viewer }: { firstName: string; viewer: Viewer }) {
  const synced = viewer.kind === "account" && viewer.lastSyncedAt !== null;
  return (
    <Reveal className="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
      <div className="flex flex-col items-center">
        <span className="size-3 rounded-full bg-accent" />
        <ThreadLine className="h-16 bg-accent/60" />
        <span className="size-3 rounded-full border-2 border-accent motion-safe:animate-pulse" />
      </div>
      <h1 className="mt-8 font-semibold text-2xl tracking-tight sm:text-3xl">Welcome, {firstName}</h1>
      <p className="mt-3 text-muted leading-relaxed">
        {synced
          ? "We didn't find any posts on your Threads account yet. Threaded learns from what you post, so suggestions get sharper as your history grows. You can start generating ideas right away."
          : "We're reading your Threads posts and insights. This page fills in as soon as the first sync finishes, usually within a minute or two."}
      </p>
      <Button asChild className="mt-8">
        <Link href="/studio">
          <Sparkles /> Open Studio
        </Link>
      </Button>
    </Reveal>
  );
}

/** Today's plays before anything has been generated. */
export function NoPlaysYet({ goal }: { goal: Goal }) {
  return (
    <Card className="flex flex-col items-start gap-4 p-6">
      <p className="text-muted leading-relaxed">
        No ideas yet. Generate a batch in Studio and the best ones for{" "}
        <span className="text-accent">{GOAL_META[goal].label.toLowerCase()}</span> land here.
      </p>
      <Button asChild size="sm">
        <Link href="/studio">
          <Sparkles /> Generate ideas
        </Link>
      </Button>
    </Card>
  );
}
