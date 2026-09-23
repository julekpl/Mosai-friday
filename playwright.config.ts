import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

// Browser journeys and the accessibility gate (MOSAI pack T1.5). The critical
// journeys that R7 and R12 will add land in T1.7; this config is the harness
// they plug into. Locally Playwright reuses the dev server the platform already
// runs; in CI it starts its own.
//
// BP-01 (23 Sep 2026):
//   - Workers are bounded (CI 1, local 2). The suite is small, and the default
//     (≈ half the cores) crashed renderer processes under parallel cold-start
//     load in a constrained environment — 9 of 13 tests failed with
//     "Page crashed" while the same run at --workers=2 was stable.
//   - Failure evidence: traces on first retry + screenshots on failure, both
//     uploaded by CI only when the job fails, with a 7-day retention. Browser
//     tests run against the test-only backend double (no credentials, no real
//     OTP, synthetic data only), which is what makes those artifacts safe to
//     keep ("sanitized" by construction).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1 --port 5173",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
