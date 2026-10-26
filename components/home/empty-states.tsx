import { Sparkles } from "lucide-react";
import Link from "next/link";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GOAL_META, type Goal } from "@/lib/goals";

/** Home after a first sync that found no posts. */
export function FirstSync({ firstName }: { firstName: string }) {
  return (
    <Reveal className="mx-auto flex max-w-xl flex-col items-center py-12 text-center">
      <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">Welcome, {firstName}</h1>
      <p className="mt-3 mb-10 text-muted leading-relaxed">
        We didn't find any posts on your Threads account yet. Threaded learns from what you post, so suggestions get
        sharper as your history grows. You can start generating ideas right away.
      </p>
      <Button asChild>
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
