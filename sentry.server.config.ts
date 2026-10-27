import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/scrub";

// Server errors (Node runtime). Loaded from instrumentation.ts only when a DSN is set.
Sentry.init(sentryOptions(process.env.NEXT_PUBLIC_SENTRY_DSN as string, process.env.VERCEL_ENV));
