import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { exitDemoAction, startDemoAction } from "@/lib/actions/demo";
import { DEMO_PERSONA_IDS, DEMO_PERSONAS } from "@/lib/demo/personas";
import { requireViewer } from "@/lib/session/viewer";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

const UPCOMING = [
  { title: "Models", body: "Pick the AI model for each task, with its price per use." },
  { title: "Billing", body: "Credits, top-ups, auto-recharge, or your own Vercel AI Gateway key." },
  { title: "Voice", body: "Emoji, casing, banned words and how spicy suggestions get." },
  { title: "Account & data", body: "Re-sync, disconnect Threads, or delete everything." },
];

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 py-4">
      <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-fg">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-muted text-sm">Dark is the default. System follows your device.</p>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Suspense fallback={<Skeleton className="h-44 rounded-2xl" />}>
        <DemoAccountCard />
      </Suspense>

      <div className="grid gap-3 sm:grid-cols-2">
        {UPCOMING.map((item) => (
          <Card key={item.title} className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{item.title}</h2>
              <Badge variant="outline">Soon</Badge>
            </div>
            <p className="mt-2 text-muted text-sm">{item.body}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}

async function DemoAccountCard() {
  const viewer = await requireViewer();
  if (viewer.kind !== "demo") return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-fg">Demo account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={startDemoAction} className="grid gap-2 sm:grid-cols-3">
          {DEMO_PERSONA_IDS.map((id) => {
            const persona = DEMO_PERSONAS[id];
            const active = id === viewer.persona.id;
            return (
              <button
                key={id}
                type="submit"
                name="persona"
                value={id}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  active ? "border-accent/60 bg-accent/10" : "border-border hover:border-border-strong",
                )}
              >
                <p className="font-medium text-sm">{persona.label}</p>
                <p className="mt-0.5 truncate text-subtle text-xs">@{persona.profile.username}</p>
              </button>
            );
          })}
        </form>
        <form action={exitDemoAction}>
          <Button type="submit" variant="ghost" size="sm">
            <LogOut /> Exit demo
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
