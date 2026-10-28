import type { Metadata } from "next";
import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { AdminHeader } from "@/components/admin/admin-header";
import { AddModelForm, ModelForm, SyncPricesButton } from "@/components/admin/catalog-forms";
import { SubmitButton } from "@/components/billing/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { setDefaultModelAction } from "@/lib/actions/admin";
import { requireStaff } from "@/lib/admin/access";
import { type CatalogRow, listCatalog } from "@/lib/admin/catalog";
import { TASK_INFO, TASK_ORDER } from "@/lib/admin/tasks";
import type { AiTask } from "@/lib/ai/catalog";
import { CLASSIFIER_MODEL } from "@/lib/ai/classify-questions";
import { costUsd, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS } from "@/lib/ai/cost";
import { creditsForCost, DEFAULT_MARKUP } from "@/lib/pricing";

export const metadata: Metadata = { title: "Catalog · Admin", robots: { index: false } };

const TIER_ORDER = { fast: 0, balanced: 1, best: 2 } as const;
const TIER_LABEL = { fast: "Fast", balanced: "Balanced", best: "Best" } as const;
const BILLING_BADGE = {
  charged: { label: "Charged in credits", variant: "accent" },
  "on us": { label: "On us", variant: "neutral" },
  unused: { label: "Not built yet", variant: "outline" },
} as const;

export default function CatalogPage() {
  return (
    <div className="mx-auto max-w-5xl py-4">
      <Suspense fallback={<Skeleton className="h-96 rounded-2xl" />}>
        <Catalog />
      </Suspense>
    </div>
  );
}

/** Why a catalog model isn't in a task's list, or null when it is. */
function leftOut(model: CatalogRow, task: AiTask): string | null {
  if (!model.tasks.includes(task)) return "Not offered for this task";
  if (!model.enabled) return "Switched off";
  if (!model.available) return "Not offered by the Gateway";
  return null;
}

/** What Studio charges for a typical batch of 5 ideas on this model. */
function typicalCredits(model: CatalogRow): number | null {
  if (!model.tasks.includes("generate") || model.inputPrice === null || model.outputPrice === null) return null;
  const prices = { inputPrice: Number(model.inputPrice), outputPrice: Number(model.outputPrice) };
  const cost = costUsd(prices, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS[5]);
  return creditsForCost(cost, Number(model.markup), model.minCredits);
}

async function Catalog() {
  await requireStaff();
  const rows = (await listCatalog()).sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.modelId.localeCompare(b.modelId),
  );

  return (
    <>
      <AdminHeader
        active="/admin/catalog"
        title="Model catalog"
        description="Which model runs each AI task, which ones people can choose in Studio, and what they're charged. Prices come from the AI Gateway every night."
        action={<SyncPricesButton />}
      />

      <section aria-labelledby="tasks">
        <SectionHeading id="tasks" title="Tasks">
          Each task runs on its default model. A task's list holds the catalog models that are switched on, offered by
          the Gateway and offered for that task (under Models, below). People pick from Studio ideas' list in Studio;
          every other task always uses its default. On the own-key plan, everything runs on the workspace's key and
          nothing is charged in credits. Run <code>pnpm eval</code> before changing Studio's default.
        </SectionHeading>
        <div className="grid gap-3 md:grid-cols-2">
          {TASK_ORDER.map((task) => (
            <TaskCard key={task} task={task} rows={rows} />
          ))}
        </div>
      </section>

      <section aria-labelledby="models" className="mt-10">
        <SectionHeading id="models" title="Models">
          Every model in the catalog, cheapest tier first.
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <Term name="Offered for">Which tasks' lists the model appears in.</Term>
            <Term name="Switched on">Off takes it out of every list. A task's default can't be switched off.</Term>
            <Term name="Markup and minimum credits">
              Studio charges the Gateway's cost × the markup, and at least the minimum. Background tasks are on us, so
              these don't apply to them.
            </Term>
            <Term name="Tier">
              Shown in Studio's picker. If a model fails, the Gateway tries another one in the same tier.
            </Term>
          </dl>
        </SectionHeading>
        <div className="grid gap-3">
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
                typicalCredits: typicalCredits(m),
              }}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="add-model" className="mt-10">
        <SectionHeading id="add-model" title="Add a model">
          Browse every model the AI Gateway offers, with its price, under{" "}
          <Link href="/admin/models" className="text-accent hover:underline">
            Gateway models
          </Link>
          , and add it from there. Or add one by its Gateway ID here. It starts switched off with a {DEFAULT_MARKUP}×
          markup: compare it with <code>pnpm eval --model &lt;id&gt;</code> first, then switch it on under Models.
        </SectionHeading>
        <AddModelForm />
      </section>
    </>
  );
}

function SectionHeading({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="font-semibold text-lg tracking-tight">
        {title}
      </h2>
      <div className="mt-1 max-w-3xl text-muted text-sm">{children}</div>
    </div>
  );
}

function Term({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-fg">{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function TaskCard({ task, rows }: { task: AiTask; rows: CatalogRow[] }) {
  const info = TASK_INFO[task];
  const badge = BILLING_BADGE[info.billing];
  const listed = rows.filter((m) => leftOut(m, task) === null);
  const missing = new Map<string, string[]>();
  for (const m of rows) {
    const why = leftOut(m, task);
    if (why) missing.set(why, [...(missing.get(why) ?? []), m.label]);
  }
  const current = rows.find((m) => m.defaultFor.includes(task));

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">
            {info.name} <span className="font-mono font-normal text-subtle text-xs">{task}</span>
          </h3>
          <p className="mt-1 text-muted text-sm">{info.summary}</p>
        </div>
        <Badge variant={badge.variant} className="shrink-0">
          {badge.label}
        </Badge>
      </div>

      {task === "generate" && listed.length > 0 && (
        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <p className="font-medium">Studio's picker</p>
          <ul className="mt-1 grid gap-0.5 text-muted">
            {listed.map((m) => (
              <li key={m.modelId} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">
                  {m.label} · {TIER_LABEL[m.tier]}
                </span>
                <span className="font-mono tabular-nums">≈{typicalCredits(m) ?? "?"} cr</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-subtle text-xs">What a typical batch of 5 ideas costs on credits.</p>
        </div>
      )}

      {task === "classify" && (
        <div className="rounded-lg bg-surface-2 p-3 text-sm">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">Jev</span>
            <span className="font-mono text-subtle text-xs">{CLASSIFIER_MODEL}</span>
            <Badge variant="outline">Set in code</Badge>
          </p>
          <p className="mt-1 text-muted">
            Answers the label questions for every post. It's a decision model: it can only pick from the answers it's
            given, so it can't name topics or write ideas, and it isn't in the catalog.
          </p>
        </div>
      )}

      <form action={setDefaultModelAction} className="mt-auto grid gap-1.5">
        <input type="hidden" name="task" value={task} />
        <label htmlFor={`default-${task}`} className="text-sm">
          {task === "classify" ? "Names topics and backs up Jev" : "Default"}
        </label>
        {task === "classify" && (
          <p className="text-subtle text-xs">
            Names each account's topics, which Jev files posts under, and re-decides the answers Jev is unsure of (every
            post, while Jev is down).
          </p>
        )}
        <div className="flex items-center gap-2">
          <select
            id={`default-${task}`}
            name="modelId"
            defaultValue={current?.modelId}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border-strong bg-surface-2 px-2.5 text-sm"
          >
            {listed.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.label}
              </option>
            ))}
          </select>
          <SubmitButton size="sm" variant="outline">
            Set
          </SubmitButton>
        </div>
        {[...missing].map(([why, labels]) => (
          <p key={why} className="text-subtle text-xs">
            {why}: {labels.join(", ")}.
          </p>
        ))}
      </form>
    </Card>
  );
}
