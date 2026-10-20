import { cookies } from "next/headers";
import { demoGenerationResponse } from "@/lib/ai/demo";
import { startGeneration } from "@/lib/ai/generate";
import { isAiConfigured } from "@/lib/ai/models";
import { generateRequestSchema } from "@/lib/ai/schemas";
import { isDemoPersonaId } from "@/lib/demo/personas";
import { DEMO_COOKIE } from "@/lib/session/cookies";
import { getAccountIdentity } from "@/lib/session/identity";

// Generations stream for 10–30 seconds.
export const maxDuration = 60;

/** Studio's "Generate": streams structured post ideas (see lib/ai/generate.ts). */
export async function POST(request: Request) {
  const parsed = generateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });

  const identity = await getAccountIdentity();
  if (!identity) {
    const persona = (await cookies()).get(DEMO_COOKIE)?.value;
    if (isDemoPersonaId(persona)) return demoGenerationResponse(persona, parsed.data);
    return Response.json({ error: "not_signed_in" }, { status: 401 });
  }
  if (!isAiConfigured()) return Response.json({ error: "ai_unavailable" }, { status: 503 });

  return startGeneration({ identity, request: parsed.data, signal: request.signal });
}
