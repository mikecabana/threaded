"use client";

import { CalendarClock, ChartColumn, House, Settings, Sparkles } from "lucide-react";
import { LayoutGroup, m } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/home", label: "Home", icon: House },
  { href: "/studio", label: "Studio", icon: Sparkles },
  { href: "/queue", label: "Queue", icon: CalendarClock },
  { href: "/insights", label: "Insights", icon: ChartColumn },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Desktop rail navigation with a sliding active indicator. */
export function RailNav() {
  const isActive = useActive();
  return (
    <LayoutGroup id="rail-nav">
      <nav aria-label="Main" className="flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-10 items-center gap-3 rounded-xl px-3 font-medium text-sm transition-colors",
                active ? "text-fg" : "text-muted hover:text-fg",
              )}
            >
              {active && (
                <m.span
                  layoutId="rail-active"
                  className="absolute inset-0 rounded-xl border border-border bg-surface-2"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon className={cn("relative size-[18px]", active && "text-accent")} aria-hidden />
              <span className="relative">{label}</span>
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}

/**
 * Mobile bottom tab bar (Settings lives behind the avatar on small screens).
 * Its background carries on below it: Safari 26 on iOS pins fixed elements
 * above its floating toolbar and keeps drawing the page underneath, so
 * without it the page scrolls by under the tabs.
 */
export function BottomTabs() {
  const isActive = useActive();
  return (
    <LayoutGroup id="bottom-tabs">
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-border border-t bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-40 after:bg-bg md:hidden"
      >
        <div className="grid grid-cols-4">
          {NAV_ITEMS.filter((item) => item.href !== "/settings").map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-16 flex-col items-center justify-center gap-1 font-medium text-[11px]",
                  active ? "text-fg" : "text-subtle",
                )}
              >
                {active && (
                  <m.span
                    layoutId="tab-active"
                    className="absolute top-0 h-0.5 w-10 rounded-full bg-accent"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className={cn("size-5", active && "text-accent")} aria-hidden />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </LayoutGroup>
  );
}
