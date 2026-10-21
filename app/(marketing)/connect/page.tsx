import { Eye, Lock, Send, ShieldCheck, Trash, User } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DemoButton } from "@/components/marketing/demo-button";
import { Reveal, Stagger, StaggerItem } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Connect Threads" };

const ACCESS: { icon: ReactNode; title: string; body: string; scope: string }[] = [
  {
    icon: <User />,
    title: "Your profile",
    body: "Username, name, bio and picture, so suggestions match who you are.",
    scope: "threads_basic",
  },
  {
    icon: <Eye />,
    title: "Your posts and insights",
    body: "Post text plus views, likes, replies, reposts, quotes and follower counts. This is how we learn what works for you.",
    scope: "threads_manage_insights",
  },
  {
    icon: <Send />,
    title: "Posting for you",
    body: "Only when you press Post or schedule a post yourself. Threaded never posts on its own.",
    scope: "threads_content_publish",
  },
];

const PROMISES: { icon: ReactNode; text: string }[] = [
  { icon: <Lock />, text: "Your Threads access token is encrypted at rest and never leaves our servers." },
  { icon: <ShieldCheck />, text: "We don't sell your data or use it to train AI models." },
  { icon: <Trash />, text: "Disconnect any time, and delete everything with one click." },
];

export default function ConnectPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 sm:py-24">
      <Reveal>
        <h1 className="text-balance font-semibold text-3xl tracking-tight sm:text-4xl">What Threaded can see and do</h1>
        <p className="mt-4 text-muted leading-relaxed">
          Signing in with Threads asks you to approve three permissions. Here's exactly what each one is for.
        </p>
      </Reveal>

      <Stagger className="mt-10 space-y-3" delay={0.1}>
        {ACCESS.map((item) => (
          <StaggerItem key={item.scope}>
            <Card className="flex gap-4 p-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent [&_svg]:size-5">
                {item.icon}
              </span>
              <div>
                <h2 className="font-semibold">{item.title}</h2>
                <p className="mt-1 text-muted text-sm leading-relaxed">{item.body}</p>
                <code className="mt-2 inline-block font-mono text-subtle text-xs">{item.scope}</code>
              </div>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>

      <Reveal delay={0.2}>
        <ul className="mt-8 space-y-3 text-muted text-sm">
          {PROMISES.map((p) => (
            <li key={p.text} className="flex gap-3 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-accent">
              {p.icon}
              {p.text}
            </li>
          ))}
        </ul>

        <Card className="mt-10 p-6">
          <Button size="lg" className="w-full" disabled>
            Continue with Threads
          </Button>
          <p className="mt-4 text-center text-muted text-sm">
            Threads sign-in isn't open yet. You can explore everything with a demo account in the meantime.
          </p>
          <DemoButton variant="outline" size="lg" className="mt-4 w-full" />
        </Card>

        <p className="mt-6 text-center text-subtle text-xs">
          By continuing you agree to our{" "}
          <Link href="/legal/terms" className="underline hover:text-fg">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="underline hover:text-fg">
            Privacy Policy
          </Link>
          .
        </p>
      </Reveal>
    </div>
  );
}
