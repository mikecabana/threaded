import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import { AddModelForm, ModelForm, SyncPricesButton } from "@/components/admin/catalog-forms";
import { SubmitButton } from "@/components/billing/submit-button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { setDefaultModelAction } from "@/lib/actions/admin";
import { requireStaff } from "@/lib/admin/access";
import { listCatalog } from "@/lib/admin/catalog";
import { AI_TASKS } from "@/lib/ai/catalog";

export const metadata: Metadata = { title: "Catalog · Admin", robots: { index: false } };

const TIER_ORDER = { fast: 0, balanced: 1, best: 2 } as const;
const TASK_HELP: Record<(typeof AI_TASKS)[number], string> = {
  generate: "Studio's ideas (charged in credits)",
  critique: "Reranking drafts (charged)",
  classify: "Topic names during sync (on us)",
  dna: "Profile DNA, weekly (on us)",
};

export default function CatalogPage() {
  return (
    <div className="mx-auto max-w-5xl py-4">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Catalog />
      </Suspense>
    </div>
  );
}

async function Catalog() {
  await requireStaff();
  const rows = (await listCatalog()).sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.modelId.localeCompare(b.modelId),
  );
  const usable = rows.filter((m) => m.enabled && m.available);

  return (
    <>
      <AdminHeader
        active="/admin/catalog"
        title="Model catalog"
        description="Which models people can pick, what each costs them, and each task's default. Prices come from the AI Gateway every night."
        action={<SyncPricesButton />}
      />

      <Card className="p-4">
        <h2 className="font-medium">Defaults</h2>
        <p className="mt-1 text-muted text-sm">
          What each task uses unless someone picks another model. Run <code>pnpm eval</code> before changing Studio's.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {AI_TASKS.map((task) => {
            const offered = usable.filter((m) => m.tasks.includes(task));
            const current = rows.find((m) => m.defaultFor.includes(task));
            return (
              <form key={task} action={setDefaultModelAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="task" value={task} />
                <label className="grid min-w-0 flex-1 gap-1 text-sm">
                  <span>
                    {task} <span className="text-subtle">· {TASK_HELP[task]}</span>
                  </span>
                  <select
                    name="modelId"
                    defaultValue={current?.modelId}
                    className="h-9 rounded-lg border border-border-strong bg-surface-2 px-2.5 text-sm"
                  >
                    {offered.map((m) => (
                      <option key={m.modelId} value={m.modelId}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton size="sm" variant="outline">
                  Set
                </SubmitButton>
              </form>
            );
          })}
        </div>
      </Card>

      <div className="mt-5 grid gap-3">
        {rows.map((m) => (
          <ModelForm
            key={m.modelId}
            model={{
              modelId: m.modelId,
              label: m.label,
              provider: m.provider,
              tier: m.tier,
              tasks: m.tasks,
              defaultFor: m.defaultFor,
              markup: m.markup,
              minCredits: m.minCredits,
              inputPrice: m.inputPrice,
              outputPrice: m.outputPrice,
              enabled: m.enabled,
              available: m.available,
            }}
          />
        ))}
        <AddModelForm />
      </div>
    </>
  );
}
