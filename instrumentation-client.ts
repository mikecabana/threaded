import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/scrub";

// Browser errors, scrubbed like the server's (lib/monitoring/scrub.ts). Sentry
// sets no cookies here, so it runs whatever the visitor chose for cookies.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) Sentry.init(sentryOptions(dsn, process.env.NEXT_PUBLIC_VERCEL_ENV));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
