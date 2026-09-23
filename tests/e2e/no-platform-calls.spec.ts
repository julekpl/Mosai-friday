import { expect, test } from "./fixtures/test-backend";

/**
 * R12 (network half) — no request to a platform domain with the platform vars
 * unset (MOSAI pack T1.7 / T0.8).
 *
 * BP-01: the test-only backend fixture intercepts every Convex call before
 * the network, so the only requests this observes are real page assets — the
 * platform-domain assertion below therefore holds hermetically in CI too.
 *
 * Asserted at the network layer, not by searching the source: every request the
 * browser makes while loading the app's public entry points is inspected, and
 * any request whose host is a template-platform domain fails the test and is
 * named in the output.
 *
 * The identity half of R12 — platform-signed tokens cannot authenticate — is
 * asserted in `tests/unit/platform-detach.test.ts`.
 */

/** The template platform's registrable domains. */
const PLATFORM_HOSTS = [
  /(^|\.)freebuff\.com$/i,
  /(^|\.)freebuff\.app$/i,
  /(^|\.)vly\.ai$/i,
  /(^|\.)vly\.sh$/i,
];

const PUBLIC_ROUTES = ["/", "/auth", "/system", "/definitely-not-a-real-route"];

test("the public entry points never call a platform domain", async ({ page }) => {
  const platformRequests: string[] = [];
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (PLATFORM_HOSTS.some((pattern) => pattern.test(host))) {
      platformRequests.push(request.url());
    }
  });

  for (const route of PUBLIC_ROUTES) {
    await page.goto(route);
    // Give effects (and any lazy chunk) time to fire their requests.
    await page.waitForTimeout(500);
  }

  expect(platformRequests, `platform request(s) observed: ${platformRequests.join(", ")}`).toEqual(
    [],
  );
});

test("the sign-in form loads without reaching the platform in the browser", async ({
  page,
}) => {
  const platformRequests: string[] = [];
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname;
    if (PLATFORM_HOSTS.some((pattern) => pattern.test(host))) {
      platformRequests.push(request.url());
    }
  });

  await page.goto("/auth");
  await expect(page.getByPlaceholder("name@example.com")).toBeVisible();
  // Typing starts no request; the OTP send happens server-side (Convex), so the
  // browser must stay off the platform's domains either way.
  await page.getByPlaceholder("name@example.com").fill("someone@example.com");
  await page.waitForTimeout(500);

  expect(platformRequests).toEqual([]);
});
