import "server-only";
import { z } from "zod";

// Server environment. Everything is optional so the app builds and runs the
// demo with no services configured; features call requireEnv() for what they
// need and fail loudly with the variable's name if it's missing.

const optional = z.string().min(1).optional();

const schema = z.object({
  THREADS_APP_ID: optional,
  THREADS_APP_SECRET: optional,
  /** Override for the Threads callback; by default it's derived from the production URL (lib/deployment.ts). */
  THREADS_REDIRECT_URI: z.url().optional(),
  /** Override for the production URL; on Vercel it comes from VERCEL_PROJECT_PRODUCTION_URL. */
  APP_URL: z.url().optional(),
  /** Preview deployments that may use Threads sign-in, e.g. "https://threaded-*-acme.vercel.app". */
  PREVIEW_ORIGINS: optional,
  /** 32 bytes, base64. Encrypts Threads tokens and BYOK keys. */
  SECRETS_ENC_KEY: optional,
  SESSION_SECRET: optional,
  DATABASE_URL: optional,
  KV_REST_API_URL: z.url().optional(),
  KV_REST_API_TOKEN: optional,
  /** Local development only; on Vercel the AI Gateway authenticates via OIDC. */
  AI_GATEWAY_API_KEY: optional,
  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,
  /** "1" turns on Stripe Tax for top-ups, auto-recharge and the BYOK plan (activate it in Stripe first). */
  STRIPE_AUTOMATIC_TAX: z.enum(["0", "1"]).optional(),
  /** Alert emails. Without it, emails are logged instead of sent. */
  RESEND_API_KEY: optional,
  /** Sender for alert emails, on a domain verified in Resend. Defaults to alerts@ the production domain. */
  EMAIL_FROM: optional,
  CRON_SECRET: optional,
  /**
   * "1" asks for threads_keyword_search at sign-in, so Studio can read public posts on a topic.
   * Add the permission to the Meta app first: Threads refuses sign-ins that ask for one it hasn't.
   */
  THREADS_KEYWORD_SEARCH: z.enum(["0", "1", ""]).optional(),
  /** Google Tag Manager container ("GTM-…"). Without it there are no optional cookies and no cookie banner. */
  GTM_ID: z
    .string()
    .regex(/^GTM-[A-Z0-9]+$/)
    .optional(),
  /** Comma-separated Threads user ids with access to /admin (as well as users.is_staff). */
  ADMIN_THREADS_USER_IDS: optional,
  DEMO_MODE: z.enum(["0", "1"]).optional(),
  /** Test only: point the Threads client at a mock server (see e2e/mock-meta.mjs). */
  THREADS_GRAPH_URL: z.url().optional(),
  THREADS_AUTHORIZE_URL: z.url().optional(),
  /** Test only: point Stripe and the AI Gateway's account endpoints at a mock server (see e2e/mock-billing.mjs). */
  STRIPE_API_URL: z.url().optional(),
  AI_GATEWAY_BASE_URL: z.url().optional(),
  /** Test only: point Resend at a mock server (see e2e/mock-billing.mjs). */
  RESEND_API_URL: z.url().optional(),
  /** Test only: "1" streams canned ideas from lib/ai/mock-model.ts; "error" simulates a provider failure. */
  AI_MOCK: z.enum(["1", "error", ""]).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

export const env: ServerEnv = schema.parse(process.env);

export function requireEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = env[key];
  if (value === undefined) throw new Error(`Missing environment variable ${key}. See docs/SETUP.md.`);
  return value as NonNullable<ServerEnv[K]>;
}
