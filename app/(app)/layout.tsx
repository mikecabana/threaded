import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BottomTabs, RailNav } from "@/components/app/nav-links";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { TopBar, TopBarSkeleton } from "@/components/app/top-bar";
import { Logo } from "@/components/brand/logo";

/** Signed-in pages stay out of search results (robots.txt also asks crawlers to skip them). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The navigation chrome is static and prerenders into the shell; anything that
 * reads the session streams in behind Suspense.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-border border-r px-3 py-5 md:flex">
        <Link href="/home" className="mb-8 px-3" aria-label="Home">
          <Logo />
        </Link>
        <RailNav />
        <div className="mt-auto px-1">
          <ThemeToggle />
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Suspense fallback={<TopBarSkeleton />}>
          <TopBar />
        </Suspense>
        <main className="flex-1 px-4 pt-2 pb-[calc(7rem+env(safe-area-inset-bottom))] md:px-8 md:pb-16">
          {children}
        </main>
      </div>
      <BottomTabs />
    </div>
  );
}
