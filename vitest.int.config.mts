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
    },
  },
});
