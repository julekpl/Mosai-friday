// @vitest-environment node
import { describe, expect, it } from "vitest";
import authConfig from "@/convex/auth.config";

/**
 * R12 (identity half) — no platform trust with the platform vars unset
 * (MOSAI pack T1.7 / T0.8).
 *
 * T0.8 removed the federated `customJwt` provider whose issuer was the template
 * platform. This asserts the live auth config, not a source search: the only
 * trusted provider is this deployment's own OIDC discovery, so a token the
 * platform signed can never authenticate here.
 *
 * The other half of R12 — no network request to a platform domain — is asserted
 * in the browser by `tests/e2e/no-platform-calls.spec.ts`. The server-side AI
 * gateway is still the platform SDK: retiring it is T2.9 (ModelGateway), which
 * is out of this ticket's scope and recorded in STATUS.md.
 */

type Provider = Record<string, unknown>;

describe("R12 — the platform cannot authenticate against this deployment", () => {
  const providers = authConfig.providers as unknown as Provider[];

  it("trusts exactly one provider, and it is not the platform's federated JWT", () => {
    expect(providers).toHaveLength(1);
    const [provider] = providers;
    expect(provider.type).not.toBe("customJwt");
    expect(provider.applicationID).toBe("convex");
  });

  it("names no platform issuer or domain anywhere in the trust config", () => {
    const serialized = JSON.stringify(authConfig);
    expect(serialized).not.toMatch(/freebuff/i);
    expect(serialized).not.toMatch(/vly/i);
    for (const provider of providers) {
      expect(String(provider.issuer ?? "")).not.toMatch(/freebuff|vly/i);
      expect(String(provider.domain ?? "")).not.toMatch(/freebuff|vly/i);
    }
  });
});
