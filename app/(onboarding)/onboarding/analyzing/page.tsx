import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TheRead } from "@/components/onboarding/the-read";
import { db } from "@/lib/db";
import { threadsProfiles } from "@/lib/db/schema";
import { requireViewer } from "@/lib/session/viewer";
import { toSyncStatus } from "@/lib/sync/status";
import { latestSyncRun } from "@/lib/sync/sync";

export const metadata: Metadata = { title: "Reading your Threads" };

export default function AnalyzingPage() {
  return (
    <Suspense fallback={<p className="py-24 text-center text-muted">Getting your first sync ready…</p>}>
      <Analyzing />
    </Suspense>
  );
}

async function Analyzing() {
  const viewer = await requireViewer();
  // The demo has no sync to watch.
  if (viewer.kind === "demo") redirect("/home");
  const [run, [profile]] = await Promise.all([
    latestSyncRun(viewer.profile.id),
    db()
      .select({ topics: threadsProfiles.topics })
      .from(threadsProfiles)
      .where(eq(threadsProfiles.id, viewer.profile.id)),
  ]);
  const topics = profile?.topics?.list.map((t) => t.name) ?? [];
  return <TheRead firstName={viewer.profile.name.split(" ")[0]} initial={toSyncStatus(run, topics)} />;
}
