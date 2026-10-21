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
  const { profile } = viewer.persona;
  return (
    <>
      <GoalSync goal={viewer.goal} />
      {viewer.kind === "demo" && <DemoBanner current={viewer.persona.id} />}
      <div className="flex h-16 items-center gap-3 px-4 md:px-8">
        <Link href="/home" className="md:hidden" aria-label="Home">
          <LogoMark className="size-7" />
        </Link>
        <GoalSwitcher key={viewer.goal} initialGoal={viewer.goal} />
        <div className="ml-auto flex items-center gap-2">
          <CreditsPill credits={viewer.credits} />
          <Link href="/settings" aria-label={`Settings for @${profile.username}`}>
            <Avatar name={profile.name} hue={viewer.persona.avatarHue} />
          </Link>
        </div>
      </div>
    </>
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
