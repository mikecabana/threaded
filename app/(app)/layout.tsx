import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BottomTabs, RailNav } from "@/components/app/nav-links";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { TopBar, TopBarSkeleton } from "@/components/app/top-bar";
import { Logo } from "@/components/brand/logo";
import { PlayOnMount } from "@/components/motion/scroll-reveal";

/** Signed-in pages stay out of search results (robots.txt also asks crawlers to skip them). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The navigation chrome is static and prerenders into the shell; anything that
 * reads the session streams in behind Suspense.
 *
 * On phones the shell is exactly the screen's height: the top bar, the page
 * (which scrolls on its own), then the tabs. The document itself never
 * scrolls there, so nothing passes under Safari's floating toolbar (iOS 26
 * draws the page beneath it, below any fixed bar). From md up, the page
 * scrolls as usual next to the sidebar.
 *
 * Safari doesn't report elements scrolling into view inside that scroll area,
 * so the app's entrance animations play on mount instead (PlayOnMount).
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PlayOnMount>
      <div className="flex h-dvh md:h-auto md:min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-border border-r px-3 py-5 md:flex">
          <Link href="/home" className="mb-8 px-3" aria-label="Home">
            <Logo />
          </Link>
          <RailNav />
          <div className="mt-auto px-1">
            <ThemeToggle />
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Suspense fallback={<TopBarSkeleton />}>
            <TopBar />
          </Suspense>
          <main className="min-h-0 flex-1 scroll-pt-2 overflow-y-auto overscroll-contain px-4 pt-2 pb-8 md:overflow-visible md:px-8 md:pb-16">
            {children}
          </main>
          <BottomTabs />
        </div>
      </div>
    </PlayOnMount>
  );
}
