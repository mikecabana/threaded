"use client";

import { ArrowUpRight, BookmarkX } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CopyButton } from "@/components/app/copy-button";
import { type PostAuthor, PostPreview } from "@/components/threads/post-preview";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { setSuggestionStatusAction } from "@/lib/actions/studio";
import { FORMAT_LABELS } from "@/lib/analysis/formats";
import type { StoredSuggestion } from "@/lib/data/suggestions";
import { GOAL_META } from "@/lib/goals";
import { threadsIntentUrl } from "@/lib/threads/intent";

/** Ideas the user saved, ready to post (scheduling arrives with the Queue). */
export function SavedIdeas({ author, ideas }: { author: PostAuthor; ideas: StoredSuggestion[] }) {
  const router = useRouter();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const visible = ideas.filter((idea) => !removed.has(idea.id));
  if (ideas.length === 0) return null;

  return (
    <section aria-labelledby="saved-heading" className="mt-10">
      <h2 id="saved-heading" className="mb-3 font-semibold text-lg">
        Saved ideas <span className="font-normal text-subtle">({visible.length})</span>
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        <AnimatePresence initial={false}>
          {visible.map((idea) => (
            <m.div key={idea.id} layout exit={{ opacity: 0, scale: 0.96 }}>
              <Card className="flex h-full flex-col p-4">
                <PostPreview
                  author={author}
                  text={idea.text}
                  clamp={4}
                  meta={<Badge variant="outline">{FORMAT_LABELS[idea.format]}</Badge>}
                />
                <p className="mt-3 text-subtle text-xs">For {GOAL_META[idea.goal].label.toLowerCase()}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <CopyButton text={idea.text} />
                  <Button asChild variant="outline" size="sm">
                    <a href={threadsIntentUrl(idea.text)} target="_blank" rel="noopener noreferrer">
                      Open in Threads
                      <ArrowUpRight />
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      setRemoved((r) => new Set(r).add(idea.id));
                      await setSuggestionStatusAction(idea.id, "new");
                      router.refresh();
                    }}
                  >
                    <BookmarkX /> Unsave
                  </Button>
                </div>
              </Card>
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
