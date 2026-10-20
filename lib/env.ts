import "server-only";
import { z } from "zod";

// Server environment. Everything is optional so the app builds and runs the
// demo with no services configured; features call requireEnv() for what they
// need and fail loudly with the variable's name if it's missing.

const optional = z.string().min(1).optional();

const schema = z.object({
  THREADS_APP_ID: optional,
  THREADS_APP_SECRET: optional,
  THREADS_REDIRECT_URI: z.url().optional(),
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
  RESEND_API_KEY: optional,
  CRON_SECRET: optional,
  DEMO_MODE: z.enum(["0", "1"]).optional(),
  /** Test only: point the Threads client at a mock server (see e2e/mock-meta.mjs). */
  THREADS_GRAPH_URL: z.url().optional(),
  THREADS_AUTHORIZE_URL: z.url().optional(),
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
