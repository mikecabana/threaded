import { createGateway } from "ai";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import { DataTable, StatTile } from "@/components/admin/data-table";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/admin/access";
import { marginReport, ownKeyMonthlyUsd, type SpendReport } from "@/lib/admin/margins";
import { gatewayReachable } from "@/lib/ai/models";
import { env } from "@/lib/env";
import { formatUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

const PERIODS = [7, 30, 90] as const;

export default function AdminPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  return (
    <div className="mx-auto max-w-6xl py-4">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Margins searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–");

function spendReport(): SpendReport | null {
  if (!gatewayReachable()) return null;
  const gateway = createGateway(env.AI_GATEWAY_API_KEY ? { apiKey: env.AI_GATEWAY_API_KEY } : {});
  return (params) => gateway.getSpendReport(params);
}

async function Margins({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireStaff();
  const requested = Number((await searchParams).days);
  const days = PERIODS.find((d) => d === requested) ?? 30;
  const report = await marginReport({ days, spend: spendReport() });
  const margin = report.revenueUsd - report.generationCostUsd;
  const gatewayTotal = report.gateway.ok ? report.gateway.spend.totalUsd : null;

  return (
    <>
      <AdminHeader
        active="/admin"
        title="Margins"
        description="What credits brought in against what the AI cost, for workspaces on credits."
        action={
          <nav aria-label="Period" className="flex gap-1 rounded-full border border-border p-1">
            {PERIODS.map((d) => (
              <Link
                key={d}
                href={`/admin?days=${d}`}
                aria-current={d === days ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-1 text-sm",
                  d === days ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {d} days
              </Link>
            ))}
          </nav>
        }
      />

      <section aria-label="Summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Studio revenue"
          value={formatUsd(report.revenueUsd)}
          detail={`${report.generations.toLocaleString("en-US")} generations on credits`}
        />
        <StatTile
          label="Studio AI cost"
          value={formatUsd(report.generationCostUsd)}
          detail={`Margin ${formatUsd(margin)} (${pct(margin, report.revenueUsd)})`}
        />
        <StatTile
          label="All AI spend on our account"
          value={gatewayTotal === null ? "–" : formatUsd(gatewayTotal)}
          detail={
            gatewayTotal === null
              ? "From the AI Gateway, when it's reachable"
              : `Margin after it: ${formatUsd(report.revenueUsd - gatewayTotal)}`
          }
        />
        <StatTile
          label="Credits sold"
          value={formatUsd(report.creditsSoldUsd)}
          detail={`${report.outstandingCredits.toLocaleString("en-US")} credits unspent (owed)`}
        />
      </section>
      <p className="mt-3 text-muted text-sm">
        Own-key plans: {report.ownKeyPlans} ({formatUsd(ownKeyMonthlyUsd(report.ownKeyPlans))} a month),{" "}
        {report.ownKeyGenerations.toLocaleString("en-US")} generations on their keys. Free credits:{" "}
        {report.trialCredits.toLocaleString("en-US")} in trials, {report.adjustedCredits.toLocaleString("en-US")} in
        manual adjustments.
      </p>

      <div className="mt-6 grid gap-5">
        <DataTable
          caption="Studio, by model"
          rows={report.byModel}
          rowKey={(r) => r.model}
          empty="No generations on credits in this period."
          columns={[
            { label: "Model", cell: (r) => r.model },
            { label: "Generations", numeric: true, cell: (r) => r.generations.toLocaleString("en-US") },
            { label: "Revenue", numeric: true, cell: (r) => formatUsd(r.revenueUsd) },
            { label: "AI cost", numeric: true, cell: (r) => formatUsd(r.costUsd) },
            { label: "Margin", numeric: true, cell: (r) => pct(r.revenueUsd - r.costUsd, r.revenueUsd) },
          ]}
        />

        {report.gateway.ok ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <DataTable
              caption="AI Gateway spend, by task"
              rows={report.gateway.spend.byTask}
              rowKey={(r) => r.task}
              empty="No spend in this period."
              columns={[
                { label: "Task", cell: (r) => r.task },
                { label: "Requests", numeric: true, cell: (r) => r.requests.toLocaleString("en-US") },
                { label: "Spend", numeric: true, cell: (r) => formatUsd(r.costUsd) },
              ]}
            />
            <DataTable
              caption="AI Gateway spend, by model"
              rows={report.gateway.spend.byModel}
              rowKey={(r) => r.model}
              empty="No spend in this period."
              columns={[
                { label: "Model", cell: (r) => r.model },
                { label: "Requests", numeric: true, cell: (r) => r.requests.toLocaleString("en-US") },
                { label: "Spend", numeric: true, cell: (r) => formatUsd(r.costUsd) },
              ]}
            />
          </div>
        ) : (
          <Card className="p-4 text-muted text-sm">
            Background work (classification, Profile DNA) isn't in Studio's numbers above; it comes from the AI
            Gateway's spend report, which isn't available here: {report.gateway.reason}
          </Card>
        )}

        <DataTable
          caption="Top workspaces"
          rows={report.byWorkspace}
          rowKey={(r) => r.workspaceId}
          empty="No generations on credits in this period."
          columns={[
            {
              label: "Workspace",
              cell: (r) => (
                <Link href={`/admin/workspace?id=${r.workspaceId}`} className="text-accent hover:underline">
                  {r.name}
                </Link>
              ),
            },
            { label: "Generations", numeric: true, cell: (r) => r.generations.toLocaleString("en-US") },
            { label: "Revenue", numeric: true, cell: (r) => formatUsd(r.revenueUsd) },
            { label: "AI cost", numeric: true, cell: (r) => formatUsd(r.costUsd) },
            { label: "Margin", numeric: true, cell: (r) => pct(r.revenueUsd - r.costUsd, r.revenueUsd) },
          ]}
        />
      </div>
    </>
  );
}
