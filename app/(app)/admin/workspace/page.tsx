import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdjustForm } from "@/components/admin/adjust-form";
import { AdminHeader } from "@/components/admin/admin-header";
import { DataTable, StatTile } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/admin/access";
import { workspaceDetail } from "@/lib/admin/workspaces";
import { formatUsd } from "@/lib/format";
import { CREDIT_USD } from "@/lib/pricing";

export const metadata: Metadata = { title: "Workspace · Admin", robots: { index: false } };

export default function WorkspacePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  return (
    <div className="mx-auto max-w-5xl py-4">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Workspace searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const when = (date: Date | null) => (date ? date.toISOString().replace("T", " ").slice(0, 16) : "–");

async function Workspace({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  await requireStaff();
  const detail = await workspaceDetail((await searchParams).id ?? "");
  if (!detail) notFound();
  const { workspace, wallet, lots, profiles, members, ledger, generations } = detail;

  return (
    <>
      <AdminHeader
        active="/admin/workspaces"
        title={workspace.name}
        description={`Workspace ${workspace.id}, created ${when(workspace.createdAt)} UTC.`}
      />

      <section aria-label="Money" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Balance"
          value={wallet.balance.toLocaleString("en-US")}
          detail={`Worth ${formatUsd(wallet.balance * CREDIT_USD)}; ${wallet.reserved} reserved`}
        />
        <StatTile
          label="Open lots"
          value={String(lots.open)}
          detail={`${lots.remaining.toLocaleString("en-US")} credits left in them`}
        />
        <StatTile
          label="Billing"
          value={workspace.billingMode === "byok" ? "Own key" : "Credits"}
          detail={
            workspace.subscriptionStatus
              ? `Plan ${workspace.subscriptionStatus}${workspace.subscriptionCancelAtPeriodEnd ? ", ending" : ""}`
              : "No own-key plan"
          }
        />
        <StatTile
          label="Auto-recharge"
          value={workspace.autoRecharge?.enabled ? "On" : "Off"}
          detail={workspace.stripeCustomerId ?? "No Stripe customer yet"}
        />
      </section>
      {workspace.billingNotice && (
        <p className="mt-3 text-sm">
          <Badge variant="negative">Notice</Badge> {workspace.billingNotice.message}
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-medium">Threads profiles</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {profiles.map((p) => (
              <li key={p.id}>
                @{p.username} <span className="text-subtle">({p.id})</span>{" "}
                {p.connected ? "" : <Badge variant="outline">Disconnected</Badge>}
                <span className="block text-muted text-xs">Last synced {when(p.lastSyncedAt)}</span>
              </li>
            ))}
          </ul>
          <h2 className="mt-4 font-medium">People</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {members.map((m) => (
              <li key={m.id}>
                {m.email ?? "No email"} {m.email && !m.emailVerifiedAt && <Badge variant="outline">Unconfirmed</Badge>}{" "}
                <span className="text-subtle">
                  {m.role}
                  {m.isStaff ? ", staff" : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 font-medium">Adjust credits</h2>
          <AdjustForm workspaceId={workspace.id} token={randomUUID()} />
        </Card>
      </div>

      <div className="mt-5 grid gap-5">
        <DataTable
          caption="Ledger, latest 50"
          rows={ledger}
          rowKey={(r) => r.id}
          empty="No ledger rows."
          columns={[
            { label: "When (UTC)", cell: (r) => when(r.createdAt), className: "whitespace-nowrap" },
            { label: "Kind", cell: (r) => r.kind },
            { label: "Credits", numeric: true, cell: (r) => (r.delta > 0 ? `+${r.delta}` : String(r.delta)) },
            {
              label: "Reference",
              cell: (r) => (
                <span className="break-all">
                  {r.note ?? r.ref}
                  {r.actor && <span className="block text-subtle text-xs">by Threads user {r.actor}</span>}
                </span>
              ),
            },
          ]}
        />
        <DataTable
          caption="Generations, latest 20"
          rows={generations}
          rowKey={(r) => r.id}
          empty="No generations yet."
          columns={[
            { label: "When (UTC)", cell: (r) => when(r.createdAt), className: "whitespace-nowrap" },
            { label: "Model", cell: (r) => r.model },
            { label: "Status", cell: (r) => (r.error ? `${r.status}: ${r.error}` : r.status) },
            { label: "Billing", cell: (r) => (r.billingMode === "byok" ? "Own key" : "Credits") },
            { label: "Credits", numeric: true, cell: (r) => String(r.creditsCharged) },
            { label: "AI cost", numeric: true, cell: (r) => (r.costUsd === null ? "–" : formatUsd(r.costUsd)) },
          ]}
        />
      </div>
    </>
  );
}
