"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { m, type Variants } from "motion/react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Heatmap } from "@/components/insights/heatmap";
import { revealSpring } from "@/components/motion/springs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DnaClaim, ProfileDna } from "@/lib/ai/dna-prompt";
import type { HeatCell } from "@/lib/analysis/insights";
import { formatMetric } from "@/lib/format";
import { cn } from "@/lib/utils";

const stack: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.14, delayChildren: 0.2 } } };
const card: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: revealSpring },
};

function Item({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <m.div variants={card} className={className}>
      {children}
    </m.div>
  );
}

/** The measured number behind a claim, big, with the full fact underneath. */
function Claim({ claim, tone }: { claim: DnaClaim; tone: "reward" | "blind" }) {
  const { multiplier, text } = claim.fact;
  return (
    <Card className="flex gap-4 p-5">
      <span
        className={cn(
          "shrink-0 font-mono font-semibold text-2xl tabular-nums leading-none",
          tone === "reward" ? "text-accent" : "text-muted",
        )}
      >
        {multiplier < 0.15 ? "≈0×" : formatMetric(multiplier, "multiplier")}
      </span>
      <div>
        <p className="font-medium leading-snug">{claim.claim}</p>
        <p className="mt-1 text-muted text-sm">{text}</p>
      </div>
    </Card>
  );
}

const CONFIDENCE: Record<ProfileDna["topics"][number]["confidence"], string> = {
  low: "Early signal",
  medium: "Some evidence",
  high: "Solid",
};

/**
 * Profile DNA, revealed card by card: the headline, what the audience
 * rewards (each with its number), topics, best hours, the blind spot, and the
 * voice Threaded writes in.
 */
export function DnaReveal({
  dna,
  heat,
  goalLabel,
  name,
}: {
  dna: ProfileDna;
  heat: HeatCell[];
  goalLabel: string;
  name: string;
}) {
  const topShare = Math.max(...dna.topics.map((t) => t.share), 0.01);
  return (
    <m.div className="mx-auto max-w-2xl space-y-4 py-8 sm:py-12" variants={stack} initial="hidden" animate="show">
      <Item className="pb-4">
        <p className="font-medium text-accent text-sm">
          {name}'s Profile DNA · learned from {dna.postsAnalyzed} posts
        </p>
        <h1 className="mt-3 text-balance font-display text-4xl italic leading-tight sm:text-5xl">{dna.headline}</h1>
      </Item>

      {dna.rewards.length > 0 && (
        <>
          <Item>
            <h2 className="pt-2 font-semibold">What your audience rewards</h2>
          </Item>
          {dna.rewards.map((claim) => (
            <Item key={claim.fact.text}>
              <Claim claim={claim} tone="reward" />
            </Item>
          ))}
        </>
      )}

      {dna.topics.length > 0 && (
        <Item>
          <Card className="p-5">
            <h2 className="font-semibold">What you post about</h2>
            <p className="mt-1 text-muted text-sm">
              Sized by how often you post about it. Views are against your median.
            </p>
            <ul className="mt-4 flex flex-wrap items-center gap-2">
              {dna.topics.map((topic, i) => {
                const scale = 0.8 + (topic.share / topShare) * 0.6;
                return (
                  <m.li
                    key={topic.name}
                    initial={{ opacity: 0, scale: 0.5 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ ...revealSpring, delay: 0.1 + i * 0.07 }}
                    className={cn(
                      "rounded-full border px-4 py-2",
                      topic.core ? "border-accent/60 bg-accent/10" : "border-border-strong bg-surface-2",
                    )}
                    style={{ fontSize: `${scale}rem` }}
                  >
                    <span className="font-medium">{topic.name}</span>{" "}
                    <span className="font-mono text-[0.75em] text-muted tabular-nums">
                      {formatMetric(topic.viewsMultiplier, "multiplier")}
                    </span>
                    <span className="sr-only">
                      {" "}
                      views, {topic.posts} posts, {CONFIDENCE[topic.confidence].toLowerCase()}
                    </span>
                  </m.li>
                );
              })}
            </ul>
            {dna.topics.every((t) => t.confidence === "low") ? (
              <p className="mt-3 text-subtle text-xs">Early signals, a few posts each. They sharpen as you post.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5" aria-hidden>
                {(["high", "medium", "low"] as const)
                  .filter((c) => dna.topics.some((t) => t.confidence === c))
                  .map((c) => (
                    <Badge key={c} variant="outline">
                      {CONFIDENCE[c]}:{" "}
                      {dna.topics
                        .filter((t) => t.confidence === c)
                        .map((t) => t.name)
                        .join(", ")}
                    </Badge>
                  ))}
              </div>
            )}
          </Card>
        </Item>
      )}

      {heat.length > 0 && (
        <Item>
          <Card className="p-5">
            <h2 className="font-semibold">When it lands</h2>
            <p className="mt-1 mb-4 text-muted text-sm">Your posts by day and hour, darker where they did best.</p>
            <Heatmap cells={heat} goalLabel={goalLabel} cascade />
          </Card>
        </Item>
      )}

      {dna.blindSpots.map((claim) => (
        <Item key={claim.fact.text}>
          <h2 className="pt-2 pb-3 font-semibold">Blind spot</h2>
          <Claim claim={claim} tone="blind" />
        </Item>
      ))}

      <Item>
        <Card className="p-5">
          <h2 className="font-semibold">Your voice</h2>
          {dna.voice.descriptors.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {dna.voice.descriptors.map((d) => (
                <Badge key={d} variant="accent">
                  {d}
                </Badge>
              ))}
            </div>
          )}
          {dna.voice.habits.length > 0 && (
            <ul className="mt-4 list-disc space-y-1 pl-5 text-muted text-sm">
              {dna.voice.habits.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          {dna.voice.signaturePhrases.length > 0 && (
            <p className="mt-4 text-muted text-sm">
              Phrases you come back to:{" "}
              {dna.voice.signaturePhrases.map((p, i) => (
                <span key={p}>
                  {i > 0 && ", "}
                  <span className="text-fg">“{p}”</span>
                </span>
              ))}
            </p>
          )}
          {dna.guide.length > 0 && (
            <>
              <h3 className="mt-5 font-medium text-sm">How Threaded writes as you</h3>
              <ul className="mt-2 space-y-1 text-muted text-sm">
                {dna.guide.map((g) => (
                  <li key={g} className="flex gap-2">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" />
                    {g}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </Item>

      <Item className="flex flex-wrap gap-3 pt-4">
        <Button asChild size="lg">
          <Link href="/home">
            Go to your dashboard <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link href="/studio">
            <Sparkles /> Write in your voice
          </Link>
        </Button>
      </Item>
    </m.div>
  );
}
