import { expect, test as base, type Page, type Route } from "@playwright/test";

/**
 * Test-only auth/backend setup for the browser gates (MOSAI pack BP-01).
 *
 * ## Why this exists
 *
 * CI used to hand the app `https://placeholder.convex.cloud` and implicitly
 * treat it as a working service: the signed-out redirect (`/app` → `/auth`)
 * and the sign-in response assertions silently depended on a backend that
 * answers, so against a non-existent host the Convex client waited forever
 * and those tests hung until they timed out. Locally the same tests only
 * passed because a real deployment URL happened to be loaded — and the
 * sign-in test then performed a *real* OTP send. Neither behaviour is a
 * test setup; both are lies about what is being tested.
 *
 * ## What this fixture does
 *
 * Every test that imports `test` from this module gets a page on which
 * **every Convex call is intercepted before it reaches the network**:
 *
 *   - WebSocket  …/api/<version>/sync  — a minimal double of the Convex sync
 *     protocol (Connect / ModifyQuerySet / Action → Transition /
 *     ActionResponse, shapes taken from `node_modules/convex`:
 *     `browser/sync/{protocol,remote_query_set,request_manager}.js`).
 *     Signed-out queries resolve to `null`, so `users.currentUser` answers
 *     "no user" and `RequireAuth` redirects deterministically.
 *   - HTTP POST  …/api/action          — the envelope `ConvexHttpClient`
 *     expects (`{status:"success"|"error", …}`); this is the transport
 *     `@convex-dev/auth` uses to *verify* a code
 *     (`unauthenticatedCall` → `ConvexHttpClient.action`).
 *
 * The "send a code" step (`auth:signIn` with provider params) travels over
 * the WebSocket as an `Action` message; the "verify a code" step travels
 * over HTTP. `TestBackendControl` switches each step between `success` and
 * `error`, which is how the deterministic error-state contract tests in
 * `tests/e2e/auth-contract.spec.ts` are written.
 *
 * ## Safety rules (BP-01 scope)
 *
 *   - This file lives under `tests/` and is never imported by `src/`, so it
 *     cannot ship in production.
 *   - It does not weaken or bypass any server guard: no server is involved
 *     at all; it simulates *responses*, it never authenticates anyone.
 *   - No real credentials, no real OTP sends, no provider calls. Browser
 *     traces/screenshots produced from this fixture contain only synthetic
 *     data, which is why CI may upload `test-results/` on failure.
 *   - The real OTP journey is deliberately NOT covered here — see
 *     `tests/e2e/otp-live.spec.ts` (opt-in, needs a test deployment).
 *
 * The `VITE_CONVEX_URL` in CI (`https://e2e-test-only.convex.cloud`) is a
 * syntactically valid, CSP-allowed URL that **no service answers**; because
 * every request is intercepted first, the tests never treat it as a
 * working service. If interception ever failed, the test would fail fast
 * instead of hanging — never silently pass.
 */

/** 8 zero bytes as base64 — a valid u64 timestamp of 0 for `startVersion`/`endVersion`. */
const ZERO_TS = "AAAAAAAAAAA=";

export type TestBackendControl = {
  /** Leave query responses unanswered to model an unavailable backend. */
  queries: "respond" | "unavailable";
  /** WebSocket `auth:signIn` without a code (the send-a-code step). */
  signInSend: "success" | "error" | "pending";
  /**
   * WebSocket `auth:signIn` *carrying* `params.code` (the verify step):
   * `@convex-dev/auth` sends both steps over the WS sync channel via
   * `authenticatedCall`; only token refresh uses HTTP `/api/action`.
  */
  verifyCode: "success" | "error" | "pending";
  /** Test hook for a successful verification response delivered after timeout. */
  releasePendingVerifyResponse: () => void;
};

export const SEND_ERROR_MESSAGE =
  "E2E test-only backend: could not send the code.";
export const VERIFY_ERROR_MESSAGE = "E2E test-only backend: bad code.";

type WsMessage = {
  type?: string;
  requestId?: number;
  udfPath?: string;
  args?: unknown;
  modifications?: Array<{ type?: string; queryId?: number }>;
};

/** Answer one client sync message on the WebSocket. */
function handleSyncMessage(
  ws: { send: (data: string) => void },
  raw: string | ArrayBuffer,
  state: { querySetVersion: number },
  control: TestBackendControl,
): void {
  let message: WsMessage;
  try {
    message = JSON.parse(
      typeof raw === "string" ? raw : new TextDecoder().decode(raw),
    );
  } catch {
    return; // Not JSON we understand — nothing to answer.
  }

  switch (message.type) {
    case "ModifyQuerySet": {
      if (control.queries === "unavailable") return;
      const adds = (message.modifications ?? []).filter(
        (op) => op.type === "Add" && typeof op.queryId === "number",
      );
      if (adds.length === 0) return;
      const start = state.querySetVersion;
      const end = start + adds.length;
      state.querySetVersion = end;
      // Shapes per `remote_query_set.js`: a Transition must start at the
      // version the client last saw and carry QueryUpdated modifications.
      ws.send(
        JSON.stringify({
          type: "Transition",
          startVersion: { ts: ZERO_TS, querySet: start, identity: 0 },
          endVersion: { ts: ZERO_TS, querySet: end, identity: 0 },
          modifications: adds.map((op) => ({
            type: "QueryUpdated",
            queryId: op.queryId,
            // Signed-out: every query answers "no user" / empty — enough for
            // `users.currentUser` to leave `undefined` and RequireAuth to
            // resolve. Nothing here grants access to anything.
            value: null,
            logLines: [],
          })),
        }),
      );
      return;
    }
    case "Action": {
      // The send step submits `{email}`; the verify step submits
      // `{email, code}` — `convexToJson` renders objects as [key, value]
      // pairs, so the literal key "code" identifies a verify (an e-mail
      // address can never contain the quoted key).
      const isVerify =
        message.udfPath === "auth:signIn" &&
        JSON.stringify(message.args ?? []).includes('"code"');
      if (
        message.udfPath === "auth:signIn" &&
        (isVerify ? control.verifyCode : control.signInSend) === "pending"
      ) {
        if (isVerify) {
          const requestId = message.requestId;
          control.releasePendingVerifyResponse = () => {
            ws.send(
              JSON.stringify({
                type: "ActionResponse",
                requestId,
                success: true,
                logLines: [],
                result: {},
              }),
            );
          };
        }
        return;
      }
      const failed =
        message.udfPath === "auth:signIn" &&
        (isVerify
          ? control.verifyCode === "error"
          : control.signInSend === "error");
      // Shape per `request_manager.js`: on failure the human message travels
      // in `result` (`const errorMessage = response.result`), `logLines` is
      // always iterated, and success `result` is convex-encoded JSON.
      ws.send(
        JSON.stringify({
          type: "ActionResponse",
          requestId: message.requestId,
          success: !failed,
          logLines: [],
          result: failed
            ? isVerify
              ? VERIFY_ERROR_MESSAGE
              : SEND_ERROR_MESSAGE
            : // Send-a-code success: no tokens, no redirect → the auth
              // provider reports `signingIn: false` and the UI advances to
              // the code step, exactly as with a real send.
              {},
        }),
      );
      return;
    }
    default:
      // Connect / Authenticate / … need no answer from the double.
      return;
  }
}

/** Answer a POST to Convex `…/api/action` (token-refresh transport). */
async function handleHttpAction(
  route: Route,
  requestBody: string,
  control: TestBackendControl,
): Promise<void> {
  let path = "";
  try {
    path = String((JSON.parse(requestBody) as { path?: string }).path ?? "");
  } catch {
    // Malformed body — fall through to the default answer.
  }
  // The hermetic suite never refreshes a token (it is signed out); this
  // handler exists so *any* stray HTTP action gets a deterministic answer
  // instead of a network error. `verifyCode` governs the auth:signIn path
  // should it ever arrive here.
  const failed = path === "auth:signIn" && control.verifyCode === "error";
  const body = failed
    ? { status: "error", errorMessage: "E2E test-only backend: bad code." }
    : { status: "success", value: { tokens: null }, logLines: [] };
  await route.fulfill({
    // 560 is Convex's documented UDF-failure status (see `http_client.js`),
    // which the client parses as a function error rather than transport noise.
    status: failed ? 560 : 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/** Install the test-only backend double on one page. */
export async function installTestBackend(
  page: Page,
  control: TestBackendControl,
): Promise<void> {
  await page.route(/\/api\/action$/, async (route) => {
    const requestBody = (await route.request().postData()) ?? "";
    await handleHttpAction(route, requestBody, control);
  });
  await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
    const state = { querySetVersion: 0 }; // fresh per connection
    ws.onMessage((raw) => handleSyncMessage(ws, raw, state, control));
  });
}

/**
 * The browser-gate test object: every page gets the test-only backend
 * double installed before the test body runs. Mutate `testBackend` before
 * the first navigation to choose error scenarios.
 */
export const test = base.extend<{ testBackend: TestBackendControl }>({
  // Playwright requires object destructuring in the first parameter. `browser`
  // is a real built-in fixture (a dependency of `page` anyway) so the pattern
  // is non-empty for ESLint, and the callbacks are named `complete` rather
  // than `use` so the react-hooks rule does not mistake Playwright's API for a
  // React hook — no React is involved here.
  testBackend: async ({ browser }, complete) => {
    void browser;
    await complete({
      queries: "respond",
      signInSend: "success",
      verifyCode: "success",
      releasePendingVerifyResponse: () => {},
    });
  },
  page: async ({ page, testBackend }, complete) => {
    await installTestBackend(page, testBackend);
    await complete(page);
  },
});

export { expect };
