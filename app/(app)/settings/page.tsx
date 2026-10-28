import { BellRing, ChevronRight, Download, LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Avatar } from "@/components/app/avatar";
import { SyncNowButton } from "@/components/app/sync-now-button";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { DeleteAccount, DisconnectThreads } from "@/components/settings/data-controls";
import { EmailForm } from "@/components/settings/email-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { exitDemoAction, startDemoAction } from "@/lib/actions/demo";
import { removeEmailAction } from "@/lib/actions/email";
import { signOutAction } from "@/lib/actions/session";
import { currentStaff } from "@/lib/admin/access";
import { isLivePlan } from "@/lib/billing/subscription";
import { billingOverview } from "@/lib/data/billing";
import { DEMO_PERSONA_IDS, DEMO_PERSONAS } from "@/lib/demo/personas";
import { alertAddress } from "@/lib/email/verify";
import { timeAgo } from "@/lib/format";
import { type DemoViewer, requireViewer } from "@/lib/session/viewer";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settings" };

const UPCOMING = [
  { title: "Models", body: "Pick the AI model for each task, with its price per use." },
  { title: "Voice", body: "Emoji, casing, banned words and how spicy suggestions get." },
];

export default function SettingsPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
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
        <AccountCard />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-40 rounded-2xl" />}>
        <EmailCard searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={null}>
        <AdminLink />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-56 rounded-2xl" />}>
        <DataCard />
      </Suspense>

      <Link href="/settings/billing" className="group block">
        <Card className="flex items-center justify-between gap-4 p-5 transition-colors group-hover:border-border-strong">
          <div>
            <h2 className="font-medium">Billing</h2>
            <p className="mt-1 text-muted text-sm">
              Credits, top-ups, auto-recharge, or your own Vercel AI Gateway key.
            </p>
          </div>
          <ChevronRight className="size-5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
        </Card>
      </Link>

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

async function AccountCard() {
  const viewer = await requireViewer();
  if (viewer.kind === "demo") return <DemoAccountCard viewer={viewer} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-fg">Threads account</CardTitle>
        {!viewer.connected && <Badge variant="negative">Disconnected</Badge>}
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <Avatar name={viewer.profile.name} hue={viewer.profile.avatarHue} />
        <div className="min-w-0">
          <p className="truncate font-medium">{viewer.profile.name}</p>
          <p className="truncate text-sm text-subtle">@{viewer.profile.username}</p>
          <p className="truncate font-mono text-subtle text-xs">Threads user ID {viewer.profile.id}</p>
        </div>
        <form action={signOutAction} className="ml-auto">
          <Button type="submit" variant="ghost" size="sm">
            <LogOut /> Sign out
          </Button>
        </form>
      </CardContent>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 border-border border-t pt-4">
        <p className="text-muted text-sm">
          {viewer.lastSyncedAt
            ? `Last synced ${timeAgo(viewer.lastSyncedAt.toISOString(), viewer.now)} ago. Threaded refreshes every morning.`
            : "Your first sync hasn't finished yet."}
        </p>
        {viewer.connected && <SyncNowButton />}
      </CardContent>
    </Card>
  );
}

/** Account & data: download everything, disconnect Threads, or delete the account. */
async function DataCard() {
  const viewer = await requireViewer();
  if (viewer.kind === "demo") return null;
  const billing = await billingOverview(viewer.workspaceId);
  const consequences = [
    "Your Threads posts, insights, Profile DNA, ideas and scheduled posts are deleted, and nothing scheduled goes out.",
    billing.balance > 0 ? `Your ${billing.balance.toLocaleString("en-US")} unused credits are lost.` : null,
    billing.plan && isLivePlan(billing.plan.status) ? "Your own-key plan ends now." : null,
    "Payment records stay with Stripe, and our credit history stays for accounting, without your name or Threads account.",
  ].filter((line): line is string => line !== null);
  const rows = [
    {
      title: "Download your data",
      body: "Your profile, posts and insights, Profile DNA, ideas, scheduled posts and credit history, as a JSON file.",
      action: (
        <Button asChild variant="outline" size="sm">
          <a href="/api/account/export" download>
            <Download /> Download
          </a>
        </Button>
      ),
    },
    viewer.connected && {
      title: "Disconnect Threads",
      body: "Stops syncing and posting, and forgets Threaded's access. Your data stays; signing in with Threads reconnects.",
      action: <DisconnectThreads />,
    },
    {
      title: "Delete account",
      body: "Deletes your account and everything Threaded keeps about you.",
      action: <DeleteAccount username={viewer.profile.username} consequences={consequences} />,
    },
  ].filter((row) => !!row);
  return (
    <Card id="data">
      <CardHeader>
        <CardTitle className="text-fg">Account &amp; data</CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-border p-0">
        {rows.map((row) => (
          <div key={row.title} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0 max-w-md">
              <h3 className="font-medium text-sm">{row.title}</h3>
              <p className="mt-0.5 text-muted text-sm">{row.body}</p>
            </div>
            {row.action}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Only staff see the way into /admin. */
async function AdminLink() {
  if (!(await currentStaff())) return null;
  return (
    <Link href="/admin" className="group block">
      <Card className="flex items-center justify-between gap-4 p-5 transition-colors group-hover:border-border-strong">
        <div>
          <h2 className="font-medium">Admin</h2>
          <p className="mt-1 text-muted text-sm">Margins, the model catalog, and workspace lookup.</p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
      </Card>
    </Link>
  );
}

const ALERTS = [
  "A scheduled post didn't go out",
  "Auto-recharge couldn't charge your card",
  "Your own-key plan ended",
  "Your Threads connection is about to lapse",
];

const EMAIL_NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  confirmed: { tone: "ok", text: "Email confirmed. Alerts will go there." },
  expired: { tone: "error", text: "That link has expired or was already replaced. Send a new one." },
};

async function EmailCard({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const viewer = await requireViewer();
  if (viewer.kind === "demo") return null;
  const [address, { email: flag }] = await Promise.all([alertAddress(viewer.userId), searchParams]);
  const notice = flag ? EMAIL_NOTICES[flag] : undefined;
  return (
    <Card id="email">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-fg">
          <BellRing className="size-4" aria-hidden /> Email alerts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && (
          <p role="status" className={cn("text-sm", notice.tone === "ok" ? "text-fg" : "text-negative")}>
            {notice.text}
          </p>
        )}
        <div className="text-muted text-sm">
          <p>Threaded emails you only when something needs you:</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {ALERTS.map((alert) => (
              <li key={alert}>{alert}</li>
            ))}
          </ul>
        </div>
        {address && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
            <p className="min-w-0 text-sm">
              Alerts go to <span className="break-all font-medium">{address}</span>
            </p>
            <form action={removeEmailAction}>
              <Button type="submit" variant="ghost" size="sm">
                Remove
              </Button>
            </form>
          </div>
        )}
        <EmailForm current={address} />
      </CardContent>
    </Card>
  );
}

function DemoAccountCard({ viewer }: { viewer: DemoViewer }) {
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
