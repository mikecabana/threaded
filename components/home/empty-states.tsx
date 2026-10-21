import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GOAL_META, type Goal } from "@/lib/goals";
import type { SyncStatus } from "@/lib/sync/status";
import { SyncProgress } from "./sync-progress";

/** Home before any posts have been synced: live sync progress, or a nudge if there's nothing to sync. */
export function FirstSync({ firstName, sync }: { firstName: string; sync: SyncStatus }) {
  const finishedEmpty = sync.status === "succeeded";
  return (
    <Reveal className="mx-auto flex max-w-xl flex-col items-center py-12 text-center">
      <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">Welcome, {firstName}</h1>
      <p className="mt-3 mb-10 text-muted leading-relaxed">
        {finishedEmpty
          ? "We didn't find any posts on your Threads account yet. Threaded learns from what you post, so suggestions get sharper as your history grows. You can start generating ideas right away."
          : "We're reading your Threads posts and insights to learn what your audience rewards. This usually takes a minute or two."}
      </p>
      {finishedEmpty ? (
        <Button asChild>
          <Link href="/studio">
            <Sparkles /> Open Studio
          </Link>
        </Button>
      ) : (
        <SyncProgress initial={sync} />
      )}
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
