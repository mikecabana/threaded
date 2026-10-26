import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin", label: "Margins" },
  { href: "/admin/catalog", label: "Catalog" },
  { href: "/admin/workspaces", label: "Workspaces" },
] as const;

/** The admin area's heading and tabs. Rendered only after the staff check. */
export function AdminHeader({
  active,
  title,
  description,
  action,
}: {
  active: (typeof TABS)[number]["href"];
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <nav aria-label="Admin" className="mb-5 flex gap-1 overflow-x-auto border-border border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.href === active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              tab.href === active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-1 text-muted">{description}</p>
        </div>
        {action}
      </div>
    </header>
  );
}
