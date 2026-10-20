import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Meta's uninstall and data-deletion callbacks POST a `signed_request`:
// "<base64url HMAC-SHA256 signature>.<base64url JSON payload>", signed with
// the app secret over the encoded payload.

const payloadSchema = z.object({
  algorithm: z.string(),
  user_id: z.union([z.string(), z.number()]).transform(String),
  issued_at: z.number().optional(),
});

export type SignedRequestPayload = z.infer<typeof payloadSchema>;

/** Returns the verified payload, or null for anything forged or malformed. */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequestPayload | null {
  const [encodedSig, encodedPayload, extra] = signedRequest.split(".");
  if (!encodedSig || !encodedPayload || extra !== undefined) return null;

  const expected = createHmac("sha256", appSecret).update(encodedPayload).digest();
  const actual = Buffer.from(encodedSig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.algorithm.toUpperCase() !== "HMAC-SHA256") return null;
    return parsed.data;
  } catch {
    return null;
  }
}
