import { consentRequired, geoFrom } from "@/lib/consent/consent";
import { env } from "@/lib/env";

/**
 * What the cookie banner needs (components/consent): the Tag Manager container,
 * if there is one, and whether this visitor's location asks for consent first.
 */
export async function GET(request: Request) {
  return Response.json(
    { gtmId: env.GTM_ID ?? null, required: consentRequired(geoFrom(request.headers)) },
    { headers: { "cache-control": "private, no-store" } },
  );
}
