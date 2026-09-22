import path from "path";
import { defineConfig } from "vitest/config";

// Vitest uses its own config so it never reads (or changes) vite.config.ts, which
// is owned by the platform integration. Unit tests run against `convex-test`,
// which mocks the Convex backend; the environment is Convex's edge runtime.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "edge-runtime",
    include: ["tests/unit/**/*.test.ts"],
    // Playwright owns the browser journeys; keep them out of the Vitest run.
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
});
