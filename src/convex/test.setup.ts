/// <reference types="vite/client" />
/**
 * Test module registry for `convex-test` (MOSAI pack T1.5).
 *
 * `convex.json` points `functions` at `src/convex/`, so the test harness must be
 * told where the functions live. This glob is the one spot that knows, per the
 * Convex testing guide. It takes the Convex sources plus the committed
 * `_generated` JavaScript that `convex-test` needs, and excludes declaration
 * files and the tests themselves so the mock backend never treats them as
 * functions.
 */
export const modules = import.meta.glob([
  "./**/*.ts",
  "./_generated/**/*.js",
  "!./**/*.d.ts",
  "!./**/*.test.ts",
]);
