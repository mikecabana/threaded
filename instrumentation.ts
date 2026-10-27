import * as Sentry from "@sentry/nextjs";

// Error monitoring (docs/PLAN.md §13). Without NEXT_PUBLIC_SENTRY_DSN nothing is
// set up and nothing is sent.
export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

/** Errors from server components, route handlers and server actions. */
export const onRequestError = Sentry.captureRequestError;
