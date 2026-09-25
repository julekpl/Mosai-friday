import { expect, test as base, type Page } from "@playwright/test";

/**
 * Signed-in variant of the test-only backend double (`test-backend.ts`).
 *
 * The signed-out double answers every query with `null`, which is enough for
 * the public pages but never renders anything behind `RequireAuth`. This one
 * lets a browser test render a signed-in page with synthetic data so layout
 * checks (for example the phone-width checks in `project-mobile.spec.ts`)
 * run against the real components.
 *
 * How it works:
 *   - A synthetic, unsigned JWT and refresh token are placed in
 *     `localStorage` under the keys `@convex-dev/auth` reads. Nothing ever
 *     verifies them: there is no server here.
 *   - The WebSocket double confirms the client's `Authenticate` message by
 *     bumping the identity version (what a real deployment does after it
 *     accepts a token), then answers each subscribed query from `data`,
 *     keyed by the function path (`"projects:get"`). Unknown queries answer
 *     `null`, the same as the signed-out double.
 *   - HTTP `…/api/action` (token refresh) hands back the same tokens so the
 *     session stays put.
 *
 * Safety: same rules as `test-backend.ts`. Test-only, never imported by
 * `src/`, no network, no real credentials, synthetic data only.
 */

const ZERO_TS = "AAAAAAAAAAA=";

export type QueryData = Record<string, unknown>;

type SyncMessage = {
  type?: string;
  baseVersion?: number;
  newVersion?: number;
  modifications?: Array<{ type?: string; queryId?: number; udfPath?: string }>;
};

function base64Url(value: string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** An unsigned JWT with a far-future expiry. Only its shape matters. */
function syntheticJwt(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ sub: "e2e-user", iat: now, exp: now + 24 * 60 * 60 }),
  );
  return `${header}.${payload}.e2e`;
}

export async function installSignedInBackend(
  page: Page,
  data: QueryData,
): Promise<void> {
  const token = syntheticJwt();
  const refreshToken = "e2e-refresh-token";

  await page.addInitScript(
    ({ token, refreshToken }) => {
      // `@convex-dev/auth` namespaces its keys by the deployment URL
      // (`https://e2e-test-only.convex.cloud` in CI) with every
      // non-alphanumeric character removed.
      const ns = "httpse2etestonlyconvexcloud";
      window.localStorage.setItem(`__convexAuthJWT_${ns}`, token);
      window.localStorage.setItem(`__convexAuthRefreshToken_${ns}`, refreshToken);
    },
    { token, refreshToken },
  );

  await page.route(/\/api\/action$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "success",
        value: { tokens: { token, refreshToken } },
        logLines: [],
      }),
    });
  });

  await page.routeWebSocket(/\/api\/[^/]+\/sync$/, (ws) => {
    const version = { querySet: 0, identity: 0 };
    const transition = (
      next: { querySet: number; identity: number },
      modifications: unknown[],
    ) => {
      ws.send(
        JSON.stringify({
          type: "Transition",
          startVersion: { ts: ZERO_TS, ...version },
          endVersion: { ts: ZERO_TS, ...next },
          modifications,
        }),
      );
      version.querySet = next.querySet;
      version.identity = next.identity;
    };

    ws.onMessage((raw) => {
      let message: SyncMessage;
      try {
        message = JSON.parse(
          typeof raw === "string" ? raw : new TextDecoder().decode(raw),
        );
      } catch {
        return;
      }
      if (message.type === "Authenticate") {
        transition(
          { querySet: version.querySet, identity: (message.baseVersion ?? 0) + 1 },
          [],
        );
        return;
      }
      if (message.type === "ModifyQuerySet") {
        const modifications = (message.modifications ?? []).flatMap((op) => {
          if (typeof op.queryId !== "number") return [];
          if (op.type === "Remove") {
            return [{ type: "QueryRemoved", queryId: op.queryId }];
          }
          if (op.type !== "Add") return [];
          const path = (op.udfPath ?? "").replace(/\.js$/, "");
          return [
            {
              type: "QueryUpdated",
              queryId: op.queryId,
              value: path in data ? data[path] : null,
              logLines: [],
            },
          ];
        });
        transition(
          {
            querySet: message.newVersion ?? version.querySet + 1,
            identity: version.identity,
          },
          modifications,
        );
      }
    });
  });
}

export const test = base.extend<{ backendData: QueryData }>({
  backendData: async ({ browser }, complete) => {
    void browser;
    await complete({});
  },
  page: async ({ page, backendData }, complete) => {
    await installSignedInBackend(page, backendData);
    await complete(page);
  },
});

export { expect };
