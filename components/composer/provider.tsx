"use client";

import { AnimatePresence } from "motion/react";
import { createContext, type ReactNode, use, useState } from "react";
import type { PostAuthor } from "@/components/threads/post-preview";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Composer } from "./composer";

export interface ComposerDraft {
  text: string;
  topicTag?: string | null;
  /** The rest of a series, after the first post. */
  seriesParts?: string[];
  /** The idea this post came from; it's marked scheduled, then posted. */
  suggestionId?: string | null;
  /** The idea's own best slot, offered first. */
  ideaSlot?: { weekday: number; hour: number } | null;
  /** Editing a queued post rather than creating one. */
  postId?: string;
  scheduledFor?: string | null;
  mode?: "schedule" | "now";
  /** Told when the post is queued (or published, for "Post now"). */
  onQueued?: (result: { id: string; scheduledFor: string; mode: "schedule" | "now" }) => void;
}

export interface ComposerConfig {
  author: PostAuthor;
  timeZone: string;
  /** The author's best hours for the current goal, best first. */
  bestHours: number[];
}

const ComposerContext = createContext<{ open: (draft: ComposerDraft) => void } | null>(null);

/** Lets anything below it open the composer. Rendered only for accounts that can post. */
export function ComposerProvider({ config, children }: { config: ComposerConfig; children: ReactNode }) {
  const [draft, setDraft] = useState<ComposerDraft | null>(null);
  return (
    <ComposerContext value={{ open: setDraft }}>
      {children}
      <AnimatePresence>
        {draft && <Composer key="composer" config={config} draft={draft} onClose={() => setDraft(null)} />}
      </AnimatePresence>
    </ComposerContext>
  );
}

/** Null when there's no composer here (demo accounts, or signed out of Threads). */
export function useComposer() {
  return use(ComposerContext);
}

/** Opens the composer with a draft; renders nothing where posting isn't available. */
export function ComposeButton({ draft, ...props }: Omit<ButtonProps, "onClick"> & { draft: ComposerDraft }) {
  const composer = useComposer();
  if (!composer) return null;
  return <Button type="button" variant="outline" size="sm" onClick={() => composer.open(draft)} {...props} />;
}
