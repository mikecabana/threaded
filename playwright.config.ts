import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PORT ?? 3100);
/** A second server from the same build, standing in for a Vercel preview deployment. */
const previewPort = 3101;
const mockMetaPort = 3999;
const mockBillingPort = 3998;
const databaseUrl = process.env.TEST_DATABASE_URL;

/** The app's environment for real sign-in, payments and AI against the mocks. */
function appEnv(serverPort: number, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    // The local Workflow world delivers queue messages back to this port.
    PORT: String(serverPort),
    DATABASE_URL: databaseUrl as string,
    THREADS_APP_ID: "test-app",
    THREADS_APP_SECRET: "test-app-secret",
    // Meta only redirects to the registered callback (this server's); previews are relayed.
    THREADS_REDIRECT_URI: `http://localhost:${port}/api/auth/threads/callback`,
    PREVIEW_ORIGINS: `http://localhost:${previewPort}`,
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
    // Emails go to the same mock's Resend endpoint; tests read its outbox.
    RESEND_API_KEY: "re_e2e",
    RESEND_API_URL: `http://localhost:${mockBillingPort}`,
    ...overrides,
  };
}

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
      env: databaseUrl ? appEnv(port) : {},
    },
    ...(databaseUrl
      ? [
          {
            command: `pnpm start --port ${previewPort}`,
            port: previewPort,
            reuseExistingServer: !process.env.CI,
            // Its own Workflow data, so the two servers don't share a local queue.
            env: appEnv(previewPort, { WORKFLOW_LOCAL_DATA_DIR: ".workflow-data-preview" }),
          },
        ]
      : []),
  ],
});
