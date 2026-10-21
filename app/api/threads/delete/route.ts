import { deleteThreadsData } from "@/lib/accounts/provision";
import { endPlanForDeletedAccount } from "@/lib/billing/subscription";
import { randomToken } from "@/lib/crypto/sign";
import { threadsAppConfig } from "@/lib/threads/config";
import { parseSignedRequest } from "@/lib/threads/signed-request";

/**
 * Meta's data-deletion callback. Deletes the person's data and answers with a
 * status URL and confirmation code, which Meta shows them.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const signed = form?.get("signed_request");
  const payload = typeof signed === "string" ? parseSignedRequest(signed, threadsAppConfig().appSecret) : null;
  if (!payload) return Response.json({ error: "invalid signed_request" }, { status: 400 });

  const code = randomToken(12);
  // Before the profile goes: it's how we find the workspace's plan.
  await endPlanForDeletedAccount(payload.user_id);
  await deleteThreadsData(payload.user_id, code);
  const url = new URL(`/data-deletion?code=${code}`, request.url);
  return Response.json({ url: url.toString(), confirmation_code: code });
}
