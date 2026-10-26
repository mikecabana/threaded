import "server-only";
import { productionOrigin } from "@/lib/deployment";
import { env } from "@/lib/env";
import type { EmailContent } from "./templates";

// Sending through Resend's REST API. Without RESEND_API_KEY (local
// development, previews) emails are logged by kind instead of sent; the
// address and the content never go to the logs.

export type Delivery = { status: "sent"; id: string } | { status: "logged" } | { status: "failed"; error: string };

export const isEmailConfigured = () => Boolean(env.RESEND_API_KEY);

/** Where links in emails point: the live app, or this deployment when there's no production URL (tests). */
export function emailOrigin(): string {
  const origin = productionOrigin();
  if (origin) return origin;
  return env.THREADS_REDIRECT_URI ? new URL(env.THREADS_REDIRECT_URI).origin : "http://localhost:3000";
}

function sender(): string {
  if (env.EMAIL_FROM) return env.EMAIL_FROM;
  return `Threaded <alerts@${new URL(emailOrigin()).hostname.replace(/^www\./, "")}>`;
}

/**
 * Sends one email. Resend drops a repeat of the same idempotency key (for
 * 24 hours), so a retried step can't send twice. Never throws.
 */
export async function deliver(
  to: string,
  content: EmailContent,
  meta: { kind: string; idempotencyKey: string },
): Promise<Delivery> {
  if (!isEmailConfigured()) {
    console.info(`Email "${meta.kind}" not sent: RESEND_API_KEY isn't set.`);
    return { status: "logged" };
  }
  try {
    const response = await fetch(`${env.RESEND_API_URL ?? "https://api.resend.com"}/emails`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": meta.idempotencyKey,
      },
      body: JSON.stringify({
        from: sender(),
        to: [to],
        subject: content.subject,
        html: content.html,
        text: content.text,
        tags: [{ name: "kind", value: meta.kind }],
      }),
      cache: "no-store",
    });
    const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok || !body?.id) {
      return { status: "failed", error: body?.message ?? `Resend answered ${response.status}` };
    }
    return { status: "sent", id: body.id };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}
