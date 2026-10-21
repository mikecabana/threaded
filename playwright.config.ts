import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3100);
const mockMetaPort = 3999;
const mockBillingPort = 3998;
const databaseUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // The sign-in test waits for a real (local) workflow run to finish.
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    launchOptions: {
      // Lets sandboxes with a preinstalled Chromium skip `playwright install`.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testIgnore: /account\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `node e2e/mock-meta.mjs`,
      url: `http://localhost:${mockMetaPort}/health`,
      reuseExistingServer: !process.env.CI,
      env: { MOCK_META_PORT: String(mockMetaPort) },
    },
    {
      command: `node e2e/mock-billing.mjs`,
      url: `http://localhost:${mockBillingPort}/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        MOCK_BILLING_PORT: String(mockBillingPort),
        MOCK_BILLING_WEBHOOK_URL: `http://localhost:${port}/api/stripe/webhook`,
        MOCK_BILLING_WEBHOOK_SECRET: "whsec_e2e",
      },
    },
    {
      command: `pnpm start --port ${port}`,
      port,
      reuseExistingServer: !process.env.CI,
      // Real sign-in runs against the mock Meta server whenever a test database
      // is available; without one, only the demo flows are tested.
      env: databaseUrl
        ? {
            // The local Workflow world delivers queue messages back to this port.
            PORT: String(port),
            DATABASE_URL: databaseUrl,
            THREADS_APP_ID: "test-app",
            THREADS_APP_SECRET: "test-app-secret",
            THREADS_REDIRECT_URI: `http://localhost:${port}/api/auth/threads/callback`,
            THREADS_GRAPH_URL: `http://localhost:${mockMetaPort}/v1.0`,
            THREADS_AUTHORIZE_URL: `http://localhost:${mockMetaPort}/oauth/authorize`,
            SECRETS_ENC_KEY: "test:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            SESSION_SECRET: "test-session-secret",
            CRON_SECRET: "test-cron-secret",
            // Studio generates with a deterministic mock model (lib/ai/mock-model.ts).
            AI_MOCK: "1",
            // Payments and key checks run against e2e/mock-billing.mjs.
            STRIPE_SECRET_KEY: "sk_test_e2e",
            STRIPE_WEBHOOK_SECRET: "whsec_e2e",
            STRIPE_API_URL: `http://localhost:${mockBillingPort}`,
            AI_GATEWAY_BASE_URL: `http://localhost:${mockBillingPort}/v4/ai`,
          }
        : {},
    },
  ],
});
