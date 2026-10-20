import { getBalance } from "@/lib/billing/wallet";
import { generationResult } from "@/lib/data/suggestions";
import { getAccountIdentity } from "@/lib/session/identity";

/** A finished generation's stored ideas (with ids), plus the new balance. Studio calls this when a stream ends. */
export async function GET(_request: Request, context: RouteContext<"/api/generations/[id]">) {
  const identity = await getAccountIdentity();
  if (!identity) return Response.json({ error: "not_signed_in" }, { status: 401 });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not_found" }, { status: 404 });

  const result = await generationResult(identity.profileId, id);
  if (!result) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(
    { ...result, balance: await getBalance(identity.workspaceId) },
    { headers: { "cache-control": "no-store" } },
  );
}
