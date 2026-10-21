import { disconnectThreadsProfile } from "@/lib/accounts/provision";
import { threadsAppConfig } from "@/lib/threads/config";
import { parseSignedRequest } from "@/lib/threads/signed-request";

/** Meta calls this when someone removes Threaded from their Threads settings. */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  const payload = typeof signed === "string" ? parseSignedRequest(signed, threadsAppConfig().appSecret) : null;
  if (!payload) return Response.json({ error: "invalid signed_request" }, { status: 400 });

  await disconnectThreadsProfile(payload.user_id);
  return Response.json({ ok: true });
}
