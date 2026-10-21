import { eq } from "drizzle-orm";
import { CircleCheck, CircleHelp } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { deletionRequests } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Data deletion", robots: { index: false } };

/** Where Meta sends people to check a data-deletion request (see /api/threads/delete). */
export default function DataDeletionPage({ searchParams }: PageProps<"/data-deletion">) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6 sm:py-24">
      <h1 className="font-semibold text-3xl tracking-tight">Data deletion</h1>
      <Suspense fallback={<Card className="mt-8 h-28 p-6" />}>
        <Status searchParams={searchParams} />
      </Suspense>
      <p className="mt-6 text-muted text-sm">
        Questions? Email <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
      </p>
    </div>
  );
}

async function Status({ searchParams }: Pick<PageProps<"/data-deletion">, "searchParams">) {
  const { code } = await searchParams;
  const confirmationCode = typeof code === "string" ? code.slice(0, 64) : null;
  const [request] =
    confirmationCode && env.DATABASE_URL
      ? await db()
          .select()
          .from(deletionRequests)
          .where(eq(deletionRequests.confirmationCode, confirmationCode))
          .limit(1)
      : [];

  if (!request) {
    return (
      <Card className="mt-8 flex gap-4 p-6">
        <CircleHelp className="size-6 shrink-0 text-muted" aria-hidden />
        <p className="text-muted">We couldn't find a deletion request with that confirmation code.</p>
      </Card>
    );
  }
  return (
    <Card className="mt-8 flex gap-4 p-6">
      <CircleCheck className="size-6 shrink-0 text-positive" aria-hidden />
      <div>
        <p className="font-medium">
          {request.completedAt ? "Your data has been deleted." : "Your deletion request is being processed."}
        </p>
        <p className="mt-1 text-muted text-sm">
          Confirmation code <code className="font-mono">{request.confirmationCode}</code>, requested{" "}
          {request.requestedAt.toUTCString()}.
        </p>
      </div>
    </Card>
  );
}
