import "server-only";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { PostFormat } from "@/lib/analysis/formats";
import { db } from "@/lib/db";
import { generations, suggestions } from "@/lib/db/schema";
import type { Goal } from "@/lib/goals";

export type SuggestionStatus = "new" | "saved" | "dismissed" | "scheduled" | "posted";

export interface StoredSuggestion {
  id: string;
  generationId: string;
  goal: Goal;
  text: string;
  format: PostFormat;
  hook: string;
  rationale: string;
  goalFit: number;
  bestSlot: { weekday: number; hour: number };
  status: SuggestionStatus;
  createdAt: string;
}

const columns = {
  id: suggestions.id,
  generationId: suggestions.generationId,
  goal: generations.goal,
  text: suggestions.text,
  format: suggestions.format,
  hook: suggestions.hook,
  rationale: suggestions.rationale,
  goalFit: suggestions.goalFit,
  bestSlot: suggestions.bestSlot,
  status: suggestions.status,
  createdAt: suggestions.createdAt,
};

function toStored(row: {
  id: string;
  generationId: string;
  goal: Goal;
  text: string;
  format: string;
  hook: string | null;
  rationale: string | null;
  goalFit: number | null;
  bestSlot: { weekday: number; hour: number } | null;
  status: SuggestionStatus;
  createdAt: Date;
}): StoredSuggestion {
  return {
    ...row,
    format: row.format as PostFormat,
    hook: row.hook ?? "",
    rationale: row.rationale ?? "",
    goalFit: row.goalFit ?? 0,
    bestSlot: row.bestSlot ?? { weekday: 2, hour: 9 },
    createdAt: row.createdAt.toISOString(),
  };
}

/** One generation's stored suggestions, if it belongs to the profile. */
export async function generationResult(profileId: string, generationId: string) {
  const [generation] = await db()
    .select({
      id: generations.id,
      status: generations.status,
      dropped: generations.dropped,
      creditsCharged: generations.creditsCharged,
    })
    .from(generations)
    .where(and(eq(generations.id, generationId), eq(generations.profileId, profileId)));
  if (!generation) return null;
  const rows = await db()
    .select(columns)
    .from(suggestions)
    .innerJoin(generations, eq(generations.id, suggestions.generationId))
    .where(eq(suggestions.generationId, generationId))
    .orderBy(desc(suggestions.goalFit));
  return { ...generation, suggestions: rows.map(toStored) };
}

/** Recent suggestions for the profile, best first. */
export async function listSuggestions(
  profileId: string,
  options: { statuses: SuggestionStatus[]; goal?: Goal; sinceDays?: number; limit?: number },
): Promise<StoredSuggestion[]> {
  const since = new Date(Date.now() - (options.sinceDays ?? 30) * 86_400_000);
  const rows = await db()
    .select(columns)
    .from(suggestions)
    .innerJoin(generations, eq(generations.id, suggestions.generationId))
    .where(
      and(
        eq(generations.profileId, profileId),
        inArray(suggestions.status, options.statuses),
        gte(suggestions.createdAt, since),
        options.goal ? eq(generations.goal, options.goal) : undefined,
      ),
    )
    .orderBy(desc(suggestions.createdAt), desc(suggestions.goalFit))
    .limit(options.limit ?? 50);
  return rows.map(toStored);
}

/** Updates a suggestion's status if it belongs to the profile. */
export async function setSuggestionStatus(profileId: string, id: string, status: SuggestionStatus): Promise<boolean> {
  const owned = db().select({ id: generations.id }).from(generations).where(eq(generations.profileId, profileId));
  const updated = await db()
    .update(suggestions)
    .set({ status })
    .where(and(eq(suggestions.id, id), inArray(suggestions.generationId, owned)))
    .returning({ id: suggestions.id });
  return updated.length > 0;
}
