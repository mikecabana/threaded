"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/billing/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  type AdminFormState,
  addGatewayModelAction,
  addModelAction,
  syncPricesAction,
  updateModelAction,
} from "@/lib/actions/admin";
import { TASK_INFO, TASK_ORDER } from "@/lib/admin/tasks";
import type { AiTask } from "@/lib/ai/catalog";
import { cn } from "@/lib/utils";

const TIERS = ["fast", "balanced", "best"] as const;
const field =
  "h-9 w-full min-w-0 rounded-lg border border-border-strong bg-surface-2 px-2.5 text-sm outline-none focus-visible:border-accent";

export interface CatalogModel {
  modelId: string;
  label: string;
  provider: string;
  tier: (typeof TIERS)[number];
  tasks: string[];
  defaultFor: string[];
  markup: string;
  minCredits: number;
  inputPrice: string | null;
  outputPrice: string | null;
  enabled: boolean;
  available: boolean;
  /** What Studio charges for a typical batch of 5 ideas, when the model is offered there. */
  typicalCredits: number | null;
}

const price = (perMillion: string | null) => (perMillion === null ? "price unknown" : `$${Number(perMillion)}`);

function Status({ state }: { state: AdminFormState }) {
  if (!state) return null;
  return (
    <p role="status" className={cn("text-sm", state.ok ? "text-muted" : "text-negative")}>
      {state.message}
    </p>
  );
}

function TaskChecks({ name, selected }: { name: string; selected: string[] }) {
  return (
    <fieldset className="flex flex-wrap gap-3">
      <legend className="sr-only">Tasks</legend>
      {TASK_ORDER.map((task) => (
        <label key={task} className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" name={name} value={task} defaultChecked={selected.includes(task)} />
          {TASK_INFO[task].name}
        </label>
      ))}
    </fieldset>
  );
}

/** One catalog model: prices from the Gateway, everything else editable. */
export function ModelForm({ model }: { model: CatalogModel }) {
  const [state, action] = useActionState<AdminFormState, FormData>(updateModelAction, null);
  return (
    <Card className="p-4">
      <form action={action} className="space-y-3" aria-label={model.modelId}>
        <input type="hidden" name="modelId" value={model.modelId} />
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium">{model.label}</h3>
            <p className="truncate font-mono text-subtle text-xs">{model.modelId}</p>
            <p className="mt-1 text-subtle text-xs">
              {model.provider} · {price(model.inputPrice)} in / {price(model.outputPrice)} out per million tokens
              {model.typicalCredits !== null && ` · Studio: ≈${model.typicalCredits} cr for 5 ideas`}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {model.defaultFor.map((task) => (
              <Badge key={task} variant="accent">
                Default for {TASK_INFO[task as AiTask]?.name ?? task}
              </Badge>
            ))}
            {!model.enabled && <Badge variant="outline">Switched off</Badge>}
            {!model.available && <Badge variant="negative">Not offered by the Gateway</Badge>}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="grid gap-1 text-sm sm:col-span-2">
            Label
            <input name="label" defaultValue={model.label} required maxLength={60} className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            Tier
            <select name="tier" defaultValue={model.tier} className={field}>
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" name="enabled" defaultChecked={model.enabled} />
            Switched on
          </label>
          <label className="grid gap-1 text-sm">
            Markup
            <input
              name="markup"
              type="number"
              step="0.05"
              min="1"
              max="10"
              defaultValue={model.markup}
              className={field}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Minimum credits
            <input
              name="minCredits"
              type="number"
              min="0"
              max="100"
              defaultValue={model.minCredits}
              className={field}
            />
          </label>
          <div className="grid gap-1 text-sm sm:col-span-2">
            <span>Offered for</span>
            <TaskChecks name="tasks" selected={model.tasks} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton size="sm">Save</SubmitButton>
          <Status state={state} />
        </div>
      </form>
    </Card>
  );
}

/** Adds a Gateway model to the catalog, switched off. */
export function AddModelForm() {
  const [state, action] = useActionState<AdminFormState, FormData>(addModelAction, null);
  return (
    <Card className="p-4">
      <form action={action} className="space-y-3" aria-label="Add a model">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="grid gap-1 text-sm sm:col-span-2">
            Gateway model ID
            <input name="modelId" required placeholder="provider/model-name" className={cn(field, "font-mono")} />
          </label>
          <label className="grid gap-1 text-sm">
            Label
            <input name="label" required maxLength={60} className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            Provider
            <input name="provider" required maxLength={40} className={field} />
          </label>
          <label className="grid gap-1 text-sm">
            Tier
            <select name="tier" defaultValue="balanced" className={field}>
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-1 text-sm sm:col-span-3">
            <span>Offered for</span>
            <TaskChecks name="tasks" selected={["generate"]} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton size="sm">Add, switched off</SubmitButton>
          <Status state={state} />
        </div>
      </form>
    </Card>
  );
}

export function SyncPricesButton() {
  const [state, action] = useActionState<AdminFormState, FormData>(syncPricesAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <SubmitButton size="sm" variant="outline">
        Refresh prices now
      </SubmitButton>
      <Status state={state} />
    </form>
  );
}

/** Adds a model from the Gateway's list: its name and prices come from the list, the rest is picked here. */
export function AddGatewayModelForm({ modelId, tier }: { modelId: string; tier: (typeof TIERS)[number] }) {
  const [state, action] = useActionState<AdminFormState, FormData>(addGatewayModelAction, null);
  return (
    <form action={action} className="space-y-3" aria-label={`Add ${modelId}`}>
      <input type="hidden" name="modelId" value={modelId} />
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="grid gap-1 text-sm">
          Tier
          <select name="tier" defaultValue={tier} className={cn(field, "w-32")}>
            {TIERS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-1 text-sm">
          <span>Offered for</span>
          <TaskChecks name="tasks" selected={["generate"]} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="inline-flex items-center gap-1.5 text-sm">
          <input type="checkbox" name="enabled" />
          Switch on now
        </label>
        <SubmitButton size="sm">Add to the catalog</SubmitButton>
        <Status state={state} />
      </div>
    </form>
  );
}
