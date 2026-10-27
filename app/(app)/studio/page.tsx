import type { Metadata } from "next";
import { Suspense } from "react";
import { composerConfig } from "@/components/composer/config";
import { ComposerProvider } from "@/components/composer/provider";
import { Reveal } from "@/components/motion/reveal";
import { SavedIdeas } from "@/components/studio/saved-ideas";
import { Studio, type StudioModel } from "@/components/studio/studio";
import { Skeleton } from "@/components/ui/skeleton";
import { type CatalogEntry, catalogFor, DEFAULT_CATALOG, pickModel } from "@/lib/ai/catalog";
import { researchCredits, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS, typicalCredits } from "@/lib/ai/cost";
import { latestDna } from "@/lib/data/intelligence";
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

/** Typical credits for a topic's web search, or null when the catalog has no model for it. */
async function researchEstimate(): Promise<number | null> {
  const entries = await catalogFor("research");
  return entries.length ? researchCredits(pickModel(entries, "research"), "typical") : null;
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
  const dna = account ? await latestDna(account.profile.id) : null;
  const research = account ? await researchEstimate() : null;

  const composer = account ? composerConfig(account) : null;
  const content = (
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
        voicePosts={dna?.dna.postsAnalyzed ?? null}
        researchCredits={research}
      />
      <SavedIdeas author={viewer.profile} ideas={saved} />
    </>
  );
  return composer ? <ComposerProvider config={composer}>{content}</ComposerProvider> : content;
}

function StudioSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]" aria-busy>
      <Skeleton className="h-[30rem] rounded-2xl" />
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
