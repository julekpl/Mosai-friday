import path from "path";
import { defineConfig } from "vitest/config";

// Vitest uses its own config so it never reads (or changes) vite.config.ts, which
// is owned by the platform integration. Unit tests run against `convex-test`,
// which mocks the Convex backend; the environment is Convex's edge runtime.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The platform's integrations SDK reads `document` at import time and
      // cannot load under `edge-runtime`. Tests replace it with a hermetic stub
      // so the Convex modules (ai.ts, sellAI.ts, social/copilot.ts, …) load and
      // the regression suite can run offline. See tests/unit/stubs/.
      "@vly-ai/integrations": path.resolve(
        __dirname,
        "./tests/unit/stubs/vly-integrations.ts",
      ),
    },
  },
  test: {
    environment: "edge-runtime",
    setupFiles: ["./tests/unit/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    // Playwright owns the browser journeys; keep them out of the Vitest run.
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
