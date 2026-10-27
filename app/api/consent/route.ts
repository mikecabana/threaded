import { consentRequired, geoFrom } from "@/lib/consent/consent";
import { env } from "@/lib/env";

/**
 * What every page asks at load (consentBootScript in lib/consent/consent.ts):
 * the Tag Manager container, if there is one, and whether this visitor's
 * location asks for consent first, which sets Consent Mode's defaults.
 */
export async function GET(request: Request) {
  return Response.json(
    { gtmId: env.GTM_ID ?? null, required: consentRequired(geoFrom(request.headers)) },
    { headers: { "cache-control": "private, no-store" } },
  );
}
