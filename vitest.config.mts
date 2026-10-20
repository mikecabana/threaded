import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // Modules marked `server-only` are fine to import in tests.
    alias: [
      {
        find: /^server-only$/,
        replacement: fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e", "**/*.int.test.ts"],
  },
});
