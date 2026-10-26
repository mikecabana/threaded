import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import { DataTable } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/admin/access";
import { searchWorkspaces } from "@/lib/admin/workspaces";

export const metadata: Metadata = { title: "Workspaces · Admin", robots: { index: false } };

export default function WorkspacesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  return (
    <div className="mx-auto max-w-5xl py-4">
      <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
        <Lookup searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Lookup({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireStaff();
  const q = ((await searchParams).q ?? "").slice(0, 120);
  const results = q ? await searchWorkspaces(q) : [];
  return (
    <>
      <AdminHeader
        active="/admin/workspaces"
        title="Workspaces"
        description="Find an account by Threads username, workspace name or id, alert email, or Stripe customer id."
      />
      <search className="mb-5 block">
        <form className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="q">
            Search workspaces
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="@username, email, cus_…"
            className="h-10 min-w-0 flex-1 rounded-xl border border-border-strong bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle focus-visible:border-accent"
          />
          <Button type="submit">Search</Button>
        </form>
      </search>
      {q && (
        <DataTable
          caption={`Results for "${q}"`}
          rows={results}
          rowKey={(r) => r.id}
          empty="No workspace matches."
          columns={[
            {
              label: "Workspace",
              cell: (r) => (
                <Link href={`/admin/workspace?id=${r.id}`} className="text-accent hover:underline">
                  {r.name}
                </Link>
              ),
            },
            { label: "Threads", cell: (r) => r.usernames.map((u) => `@${u}`).join(", ") || "–" },
            { label: "Billing", cell: (r) => (r.billingMode === "byok" ? "Own key" : "Credits") },
            { label: "Balance", numeric: true, cell: (r) => r.balance.toLocaleString("en-US") },
            { label: "Since", cell: (r) => r.createdAt.toISOString().slice(0, 10) },
          ]}
        />
      )}
    </>
  );
}
