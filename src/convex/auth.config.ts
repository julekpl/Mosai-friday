import type { AuthConfig } from "convex/server";

// Ticket T0.8 / G20: the federated `customJwt` provider (issuer
// https://freebuff.com, applicationID "vly-convex") has been removed. It let
// the template platform's JWTs authenticate against this deployment — a
// third-party identity trust chain this product must not keep. No client code
// ever requested or set a Freebuff token, so local sign-in (emailOtp below)
// is the only auth path.

export default {
  providers: [
    // Standard Convex Auth provider for this project's own sign-in ("Get
    // Started" email, see src/convex/auth.ts). The deployment self-issues
    // JWTs (iss = CONVEX_SITE_URL, no `kid` header) validated via OIDC
    // discovery at `${domain}/.well-known/openid-configuration`, served by
    // auth.addHttpRoutes() in convex/http.ts. Do NOT convert this entry to
    // `type: "customJwt"` — that path rejects tokens without a `kid` header,
    // so sign-in would silently never confirm and RequireAuth would loop
    // back to /auth forever.
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
