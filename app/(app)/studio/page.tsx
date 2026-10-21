import type { Metadata } from "next";
import { Suspense } from "react";
import { Reveal } from "@/components/motion/reveal";
import { SavedIdeas } from "@/components/studio/saved-ideas";
import { Studio, type StudioModel } from "@/components/studio/studio";
import { Skeleton } from "@/components/ui/skeleton";
import { type CatalogEntry, catalogFor, DEFAULT_CATALOG, pickModel } from "@/lib/ai/catalog";
import { TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS, typicalCredits } from "@/lib/ai/cost";
import { getModelPick } from "@/lib/data/settings";
import { listSuggestions } from "@/lib/data/suggestions";
import { requireViewer } from "@/lib/session/viewer";

export const metadata: Metadata = { title: "Studio" };

function toStudioModel(entry: CatalogEntry): StudioModel {
  return {
    modelId: entry.modelId,
    label: entry.label,
    tier: entry.tier,
    credits: {
      3: typicalCredits(entry, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS[3]),
      5: typicalCredits(entry, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS[5]),
    },
  };
}

export default function StudioPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <Reveal className="mb-6">
        <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">Studio</h1>
        <p className="mt-1 text-muted">Generate post ideas in your voice, aimed at your goal.</p>
      </Reveal>
      <Suspense fallback={<StudioSkeleton />}>
        <StudioContent />
      </Suspense>
    </div>
  );
}

async function StudioContent() {
  const viewer = await requireViewer();
  const account = viewer.kind === "account" ? viewer : null;
  const entries = account
    ? await catalogFor("generate")
    : DEFAULT_CATALOG.filter((m) => m.enabled && m.tasks.includes("generate"));
  const pick = account ? await getModelPick(account.userId, "generate") : null;
  const saved = account
    ? await listSuggestions(account.profile.id, { statuses: ["saved"], sinceDays: 90, limit: 20 })
    : [];

  return (
    <>
      <Studio
        // A goal switch starts a fresh session in Studio.
        key={viewer.goal}
        author={viewer.profile}
        goal={viewer.goal}
        demo={viewer.kind === "demo"}
        byok={account?.billingMode === "byok"}
        models={entries.map(toStudioModel)}
        initialModelId={pickModel(entries, "generate", pick).modelId}
      />
      <SavedIdeas author={viewer.profile} ideas={saved} />
    </>
  );
}

function StudioSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]" aria-busy>
      <Skeleton className="h-[30rem] rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
