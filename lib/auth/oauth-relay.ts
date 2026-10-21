import "server-only";
import { createHash, createHmac } from "node:crypto";
import { safeEqual } from "@/lib/crypto/sign";

// Sign-in on preview deployments. Meta only redirects to the one callback URL
// registered for the app (production's), so a preview puts its own origin in
// the OAuth `state`, signed with a key derived from the Threads app secret
// (the one secret every deployment of this app shares). Production's callback
// sees a state for another origin, checks the signature and PREVIEW_ORIGINS,
// and forwards the browser there with the code. The preview then checks its
// own state cookie and exchanges the code using the same registered redirect
// URL. A relayed code is useless without the app secret anyway.

const SEPARATOR = ".";

function relayKey(appSecret: string): Buffer {
  return createHash("sha256").update(`threaded/oauth-relay:${appSecret}`).digest();
}

function mac(payload: string, appSecret: string): string {
  return createHmac("sha256", relayKey(appSecret)).update(payload).digest("base64url");
}

/** A state value that tells production's callback to send the user back to `origin`. */
export function relayState(nonce: string, origin: string, appSecret: string): string {
  const payload = `${nonce}${SEPARATOR}${Buffer.from(origin).toString("base64url")}`;
  return `${payload}${SEPARATOR}${mac(payload, appSecret)}`;
}

/** The origin a relay state points at, if it was minted by one of this app's deployments. */
export function relayOrigin(state: string | null, appSecret: string): string | null {
  const parts = state?.split(SEPARATOR);
  if (parts?.length !== 3) return null;
  const [nonce, encodedOrigin, signature] = parts;
  if (!safeEqual(signature, mac(`${nonce}${SEPARATOR}${encodedOrigin}`, appSecret))) return null;
  try {
    return new URL(Buffer.from(encodedOrigin, "base64url").toString("utf8")).origin;
  } catch {
    return null;
  }
}
