import { type NextRequest, NextResponse } from "next/server";
import { confirmEmail } from "@/lib/email/verify";

/** The link in a confirmation email: stores the address, then shows Settings. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const confirmed = token ? await confirmEmail(token) : false;
  return NextResponse.redirect(new URL(`/settings?email=${confirmed ? "confirmed" : "expired"}`, request.url));
}
