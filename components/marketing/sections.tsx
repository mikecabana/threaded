import {
  BellRing,
  CalendarClock,
  ChartLine,
  Check,
  ChevronDown,
  Dna,
  Link2,
  Send,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { GoalIcon } from "@/components/goal/goal-icon";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { ThreadLine } from "@/components/motion/thread-line";
import { TiltCard } from "@/components/motion/tilt-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GOAL_META, GOALS } from "@/lib/goals";
import { FAQS } from "@/lib/marketing/faq";
import { CREDIT_PACKS, creditsToUsd, MONTHLY_PLAN, TRIAL_CREDITS } from "@/lib/pricing";
import { SITE } from "@/lib/site";
import { DemoButton } from "./demo-button";

function SectionHeading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <Reveal className="mx-auto mb-14 max-w-2xl text-center">
      <p className="mb-3 font-medium text-accent text-sm">{eyebrow}</p>
      <h2 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">{title}</h2>
      {children && <p className="mt-4 text-muted leading-relaxed">{children}</p>}
    </Reveal>
  );
}

const STEPS = [
  {
    icon: <Link2 />,
    title: "Connect Threads",
    body: "Sign in with Threads. We read your profile, posts and insights. Nothing is ever posted without you pressing the button.",
  },
  {
    icon: <Sparkles />,
    title: "Get your Profile DNA",
    body: "Threaded finds what your audience actually rewards: your formats, topics, voice and best hours, each backed by your own numbers.",
  },
  {
    icon: <Send />,
    title: "Post what works",
    body: "Pick a goal and get post ideas in your voice. Edit, post now, or schedule them for your best time slot.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionHeading eyebrow="How it works" title="From your history to your next great post" />
      <ol className="mx-auto max-w-xl">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-5">
            <div className="flex flex-col items-center">
              <Reveal delay={i * 0.1}>
                <span className="flex size-11 items-center justify-center rounded-full border border-border-strong bg-surface text-accent [&_svg]:size-5">
                  {step.icon}
                </span>
              </Reveal>
              {i < STEPS.length - 1 && <ThreadLine className="my-2 min-h-12 flex-1" delay={0.2 + i * 0.15} />}
            </div>
            <Reveal delay={i * 0.1} className="pb-10">
              <h3 className="mt-2 font-semibold text-lg">{step.title}</h3>
              <p className="mt-2 text-muted leading-relaxed">{step.body}</p>
            </Reveal>
          </li>
        ))}
      </ol>
    </section>
  );
}

const FEATURES = [
  {
    icon: <Dna />,
    title: "Profile DNA",
    body: "Your voice, best formats, topics and posting hours, learned from your own Threads posts and backed by your numbers.",
  },
  {
    icon: <ChartLine />,
    title: "Threads analytics that explain themselves",
    body: "Views, engagement and follower trends, with what's driving them called out in plain words, not just charts.",
  },
  {
    icon: <Sparkles />,
    title: "AI post ideas in your voice",
    body: "Ideas for the goal you pick, each with its reasoning and a goal-fit score. Name a topic and Studio checks the web first.",
  },
  {
    icon: <CalendarClock />,
    title: "Post now or schedule",
    body: "Publish to Threads from the app, or schedule for your best time slot. The Queue keeps track of what's going out.",
  },
  {
    icon: <Trophy />,
    title: "A scorecard for every idea",
    body: "See how the ideas you posted did against your usual numbers. The winners teach the next batch.",
  },
  {
    icon: <BellRing />,
    title: "Alerts when it matters",
    body: "An email if a scheduled post doesn't go out or your Threads connection is about to lapse. Nothing else.",
  },
];

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionHeading eyebrow="Features" title="Everything you need to grow on Threads">
        Analytics, ideas and scheduling in one place, all working from what your own audience responds to.
      </SectionHeading>
      <Stagger className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((feature) => (
          <StaggerItem key={feature.title}>
            <Card className="h-full p-6">
              <span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent [&_svg]:size-5">
                {feature.icon}
              </span>
              <h3 className="mt-5 font-semibold text-lg">{feature.title}</h3>
              <p className="mt-2 text-muted leading-relaxed">{feature.body}</p>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

export function GoalCards() {
  return (
    <section id="goals" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionHeading eyebrow="Three goals" title="Tell it what growth means to you">
        Each goal scores your posts differently and steers every suggestion. Switch any time; the whole app follows.
      </SectionHeading>
      <Stagger className="grid gap-5 md:grid-cols-3">
        {GOALS.map((goal) => {
          const meta = GOAL_META[goal];
          return (
            <StaggerItem key={goal} data-goal={goal}>
              <TiltCard className="h-full rounded-2xl">
                <Card className="flex h-full flex-col p-6">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
                    <GoalIcon goal={goal} className="size-5" />
                  </span>
                  <h3 className="mt-5 font-semibold text-xl">{meta.label}</h3>
                  <p className="mt-2 text-muted leading-relaxed">{meta.pitch}</p>
                  <p className="mt-5 text-sm text-subtle">
                    Optimizes for <span className="text-fg">{meta.northStar.toLowerCase()}</span>
                  </p>
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-6">
                    {meta.levers.map((lever) => (
                      <Badge key={lever} variant="accent">
                        {lever}
                      </Badge>
                    ))}
                  </div>
                </Card>
              </TiltCard>
            </StaggerItem>
          );
        })}
      </Stagger>
    </section>
  );
}

function Feature({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
      <span>{children}</span>
    </li>
  );
}

export function Pricing() {
  const packs = CREDIT_PACKS.map((p) => `$${p.usd}`).join(", ");
  const perDollar = Math.round(MONTHLY_PLAN.credits / MONTHLY_PLAN.usd);
  const bestPack = Math.max(...CREDIT_PACKS.map((p) => Math.round(p.credits / p.usd)));
  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionHeading eyebrow="Pricing" title="Pay for what you generate">
        No subscription to start. See the price of every generation before you run it.
      </SectionHeading>
      <Stagger className="mx-auto grid max-w-2xl gap-5 lg:max-w-6xl lg:grid-cols-3">
        <StaggerItem>
          <Card className="h-full p-7">
            <Badge variant="outline">Free to start</Badge>
            <h3 className="mt-4 font-semibold text-xl">Pay as you go</h3>
            <p className="mt-1 text-muted">
              <span className="font-semibold text-3xl text-fg">${creditsToUsd(TRIAL_CREDITS).toFixed(0)}</span> of free
              credits to start
            </p>
            <ul className="mt-6 space-y-3 text-muted text-sm">
              <Feature>Choose from our tested models, priced per use</Feature>
              <Feature>Top up with {packs} credit packs, with bonus credits on the bigger ones</Feature>
              <Feature>Profile analysis and insights included</Feature>
              <Feature>Credits never expire</Feature>
            </ul>
            <DemoButton className="mt-8 w-full" size="lg">
              Try the demo
            </DemoButton>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card className="h-full border-accent/40 p-7">
            <Badge variant="accent">Best value</Badge>
            <h3 className="mt-4 font-semibold text-xl">Monthly plan</h3>
            <p className="mt-1 text-muted">
              <span className="font-semibold text-3xl text-fg">${MONTHLY_PLAN.usd}</span> / month for{" "}
              {MONTHLY_PLAN.credits.toLocaleString("en-US")} credits
            </p>
            <ul className="mt-6 space-y-3 text-muted text-sm">
              <Feature>
                {perDollar} credits per dollar, against up to {bestPack} with packs
              </Feature>
              <Feature>Everything in pay as you go</Feature>
              <Feature>Credits never expire, so a quiet month carries over</Feature>
              <Feature>Cancel any time and keep your credits</Feature>
            </ul>
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card className="h-full p-7">
            <Badge variant="outline">
              <Users /> For agencies
            </Badge>
            <h3 className="mt-4 font-semibold text-xl">Agency</h3>
            <p className="mt-1 text-muted">
              <span className="font-semibold text-3xl text-fg">Let's talk</span>
            </p>
            <ul className="mt-6 space-y-3 text-muted text-sm">
              <Feature>For teams that run Threads accounts for clients</Feature>
              <Feature>Tell us how you work, and we'll shape a plan around it</Feature>
              <Feature>Start on pay as you go in the meantime</Feature>
            </ul>
            <Button asChild variant="outline" size="lg" className="mt-8 w-full">
              <a href={`mailto:${SITE.contactEmail}?subject=${encodeURIComponent(`${SITE.name} for agencies`)}`}>
                Get in touch
              </a>
            </Button>
          </Card>
        </StaggerItem>
      </Stagger>
    </section>
  );
}

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-24 sm:px-6">
      <SectionHeading eyebrow="FAQ" title="Questions, answered" />
      <Reveal className="mx-auto max-w-2xl">
        <div className="divide-y divide-border border-border border-y">
          {FAQS.map((faq) => (
            <details key={faq.question} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-lg [&::-webkit-details-marker]:hidden">
                <h3>{faq.question}</h3>
                <ChevronDown
                  className="size-5 shrink-0 text-subtle transition-transform group-open:rotate-180"
                  aria-hidden
                />
              </summary>
              <p className="mt-3 text-muted leading-relaxed">{faq.answer}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
