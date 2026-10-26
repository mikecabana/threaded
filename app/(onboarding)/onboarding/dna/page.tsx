import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { DnaReveal } from "@/components/dna/dna-reveal";
import { weekHeatmap } from "@/lib/analysis/insights";
import { latestDna } from "@/lib/data/intelligence";
import { demoDna } from "@/lib/demo/dna";
import { GOAL_META } from "@/lib/goals";
import { requireViewer } from "@/lib/session/viewer";

export const metadata: Metadata = { title: "Your Profile DNA" };

export default function DnaPage() {
  return (
    <Suspense fallback={<p className="py-24 text-center text-muted">Revealing your Profile DNA…</p>}>
      <Dna />
    </Suspense>
  );
}

async function Dna() {
  const viewer = await requireViewer();
  const dna =
    viewer.kind === "demo"
      ? demoDna(viewer.persona, viewer.data, viewer.now)
      : ((await latestDna(viewer.profile.id))?.dna ?? null);
  // Too few posts, or the first one hasn't been built yet.
  if (!dna) redirect("/home");
  return (
    <DnaReveal
      dna={dna}
      heat={weekHeatmap(viewer.goal, viewer.data.posts, viewer.timezone, viewer.now)}
      goalLabel={GOAL_META[viewer.goal].label.toLowerCase()}
      name={viewer.profile.name.split(" ")[0]}
    />
  );
}
