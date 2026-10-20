import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { GoalSwitcher } from "@/components/goal/goal-switcher";
import { Skeleton } from "@/components/ui/skeleton";
import { requireViewer } from "@/lib/session/viewer";
import { Avatar } from "./avatar";
import { CreditsPill } from "./credits-pill";
import { DemoBanner } from "./demo-banner";
import { GoalSync } from "./goal-sync";

/** Session-dependent chrome; rendered inside a Suspense boundary by the app layout. */
export async function TopBar() {
  const viewer = await requireViewer();
  const { profile } = viewer;
  return (
    <>
      <GoalSync goal={viewer.goal} />
      {viewer.kind === "demo" && <DemoBanner current={viewer.persona.id} />}
      {viewer.kind === "account" && !viewer.connected && <ReconnectBanner />}
      <div className="flex h-16 items-center gap-3 px-4 md:px-8">
        <Link href="/home" className="md:hidden" aria-label="Home">
          <LogoMark className="size-7" />
        </Link>
        <GoalSwitcher key={viewer.goal} initialGoal={viewer.goal} />
        <div className="ml-auto flex items-center gap-2">
          {viewer.kind === "account" && viewer.billingMode === "byok" ? (
            <span className="rounded-full border border-border px-3 py-1.5 text-muted text-xs">Your key</span>
          ) : (
            <CreditsPill credits={viewer.credits} />
          )}
          <Link href="/settings" aria-label={`Settings for @${profile.username}`}>
            <Avatar name={profile.name} hue={profile.avatarHue} />
          </Link>
        </div>
      </div>
    </>
  );
}

function ReconnectBanner() {
  return (
    <div className="flex items-center gap-2 border-negative/30 border-b bg-negative/10 px-4 py-2 text-fg text-xs md:px-8">
      <TriangleAlert className="size-3.5 shrink-0 text-negative" aria-hidden />
      <span>Threaded lost access to your Threads account, so syncing and posting are paused.</span>
      <a href="/api/auth/threads/start" className="ml-auto shrink-0 font-medium underline underline-offset-2">
        Reconnect
      </a>
    </div>
  );
}

export function TopBarSkeleton() {
  return (
    <>
      <div className="h-[33px] border-border border-b" />
      <div className="flex h-16 items-center gap-3 px-4 md:px-8">
        <Skeleton className="h-10 w-44 rounded-full sm:w-80" />
        <Skeleton className="ml-auto h-9 w-20 rounded-full" />
        <Skeleton className="size-9 rounded-full" />
      </div>
    </>
  );
}
