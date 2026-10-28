import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import { AddGatewayModelForm } from "@/components/admin/catalog-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireStaff } from "@/lib/admin/access";
import { type CatalogRow, listCatalog } from "@/lib/admin/catalog";
import {
  batchCredits,
  fetchGatewayModels,
  filterModels,
  type GatewayModel,
  parseFilters,
  providerCounts,
  SHOW,
  SORT,
  suggestTier,
} from "@/lib/admin/gateway-models";
import { DEFAULT_MARKUP } from "@/lib/pricing";

export const metadata: Metadata = { title: "Gateway models · Admin", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Rows rendered at once; past this, searching or picking a provider narrows it down. */
const SHOWN = 100;
const control =
  "h-10 min-w-0 rounded-xl border border-border-strong bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle focus-visible:border-accent";

export default function GatewayModelsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-5xl py-4">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Models searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Models({ searchParams }: { searchParams: SearchParams }) {
  await requireStaff();
  const filters = parseFilters(await searchParams);
  const [listing, catalog] = await Promise.all([fetchGatewayModels(), listCatalog()]);
  const header = (
    <AdminHeader
      active="/admin/models"
      title="Gateway models"
      description="Every language model the AI Gateway offers. Add the ones you want to the catalog; people only see catalog models that are switched on."
    />
  );
  if (!listing.ok) {
    return (
      <>
        {header}
        <Card className="p-5 text-sm">{listing.message}</Card>
      </>
    );
  }

  const rows = new Map(catalog.map((row) => [row.modelId, row]));
  const results = filterModels(listing.models, filters, new Set(rows.keys()));
  const providers = providerCounts(listing.models);
  const added = listing.models.filter((m) => rows.has(m.id)).length;

  return (
    <>
      {header}
      <search className="mb-4 block">
        <form aria-label="Filter models" className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
          <label className="sr-only" htmlFor="q">
            Search models
          </label>
          <input id="q" name="q" defaultValue={filters.q} placeholder="Name or ID, like gemini" className={control} />
          <label className="sr-only" htmlFor="provider">
            Provider
          </label>
          <select id="provider" name="provider" defaultValue={filters.provider} className={control}>
            <option value="">All providers</option>
            {providers.map(({ provider, count }) => (
              <option key={provider} value={provider}>
                {provider} ({count})
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="show">
            Show
          </label>
          <select id="show" name="show" defaultValue={filters.show} className={control}>
            {Object.entries(SHOW).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="sort">
            Sort
          </label>
          <select id="sort" name="sort" defaultValue={filters.sort} className={control}>
            {Object.entries(SORT).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <Button type="submit">Filter</Button>
        </form>
      </search>

      <p role="status" className="mb-3 text-muted text-sm">
        {results.length === listing.models.length
          ? `${listing.models.length} language models from ${providers.length} providers`
          : `${results.length} of ${listing.models.length} language models`}
        ; {added} in the catalog.
        {results.length > SHOWN && ` Showing the first ${SHOWN}: search or pick a provider to see the rest.`}
      </p>
      <p className="mb-4 max-w-3xl text-subtle text-xs">
        Prices are the Gateway's, per million tokens. A new model starts at a {DEFAULT_MARKUP}× markup and switched off,
        unless you switch it on as you add it; compare it with <code>pnpm eval --model &lt;id&gt;</code> first. Studio
        needs structured output, and research needs tool calls, so not every model suits every task.
      </p>

      {results.length === 0 ? (
        <Card className="p-5 text-muted text-sm">No model matches.</Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {results.slice(0, SHOWN).map((model) => (
              <ModelRow key={model.id} model={model} row={rows.get(model.id)} />
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

const usd = (perMillion: number) => `$${perMillion.toLocaleString("en-US", { maximumFractionDigits: 4 })}`;

function ModelRow({ model, row }: { model: GatewayModel; row?: CatalogRow }) {
  const credits = batchCredits(model);
  return (
    <li aria-label={model.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{model.name}</span>
          <span className="font-mono text-subtle text-xs">{model.id}</span>
        </p>
        <p className="text-subtle text-xs">{model.provider}</p>
        {model.description && <p className="mt-1 line-clamp-2 text-muted text-sm">{model.description}</p>}
      </div>
      <div className="text-sm sm:text-right">
        {model.inputPrice === null || model.outputPrice === null ? (
          <p className="text-subtle">No price listed</p>
        ) : (
          <p className="tabular-nums">
            {usd(model.inputPrice)} in · {usd(model.outputPrice)} out
          </p>
        )}
        {credits !== null && (
          <p className="text-subtle text-xs tabular-nums">
            ≈{credits} cr for 5 ideas at {DEFAULT_MARKUP}×
          </p>
        )}
      </div>
      <div className="sm:col-span-2">
        {row ? (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={row.enabled ? "accent" : "outline"}>
              {row.enabled ? "In the catalog, switched on" : "In the catalog, switched off"}
            </Badge>
            <Link href="/admin/catalog#models" className="text-accent hover:underline">
              Edit in the catalog
            </Link>
          </p>
        ) : model.inputPrice === null ? (
          <p className="text-subtle text-sm">Without a price it can't be charged in credits, so it can't be added.</p>
        ) : (
          <details>
            <summary className="w-fit cursor-pointer text-accent text-sm">Add to the catalog…</summary>
            <div className="mt-3 rounded-xl bg-surface-2 p-3">
              <AddGatewayModelForm modelId={model.id} tier={suggestTier(model.outputPrice)} />
            </div>
          </details>
        )}
      </div>
    </li>
  );
}
