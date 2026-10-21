import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests run against a real Postgres. They reset the `public`
// schema, so point TEST_DATABASE_URL at a throwaway database.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.int.test.ts"],
    exclude: ["node_modules", ".next", "e2e"],
    fileParallelism: false,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      SECRETS_ENC_KEY: "test:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      SESSION_SECRET: "test-session-secret",
      // Billing tests start e2e/mock-billing.mjs on this port.
      STRIPE_SECRET_KEY: "sk_test_mock",
      STRIPE_WEBHOOK_SECRET: "whsec_test_mock",
      STRIPE_API_URL: "http://localhost:3997",
      AI_GATEWAY_BASE_URL: "http://localhost:3997/v4/ai",
    },
  },
});
