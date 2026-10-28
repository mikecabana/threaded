import { exportAccount } from "@/lib/accounts/export";
import { getAccountIdentity } from "@/lib/session/identity";

/** "Download my data" in Settings: the signed-in account's data as a JSON file. */
export async function GET() {
  const identity = await getAccountIdentity();
  if (!identity) return Response.json({ error: "not_signed_in" }, { status: 401 });
  const data = await exportAccount(identity);
  if (!data) return Response.json({ error: "not_found" }, { status: 404 });
  const filename = `threaded-${data.account.username.replace(/[^\w.-]/g, "")}-${data.exportedAt.slice(0, 10)}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
