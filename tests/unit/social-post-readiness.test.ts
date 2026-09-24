import { describe, expect, it } from "vitest";
import { getSocialPostReadiness } from "@/lib/social-post-readiness";

describe("social post actions", () => {
  it("keeps schedule and publish disabled until the connection is verified", () => {
    expect(
      getSocialPostReadiness({ connected: false, configured: true }),
    ).toEqual({
      canExecute: false,
      state: "connect",
    });
    expect(getSocialPostReadiness(undefined)).toEqual({
      canExecute: false,
      state: "checking",
    });
    expect(getSocialPostReadiness(null)).toEqual({
      canExecute: false,
      state: "unavailable",
    });
  });

  it("enables actions only after the provider reports a verified connection", () => {
    expect(
      getSocialPostReadiness({ connected: true, configured: true }),
    ).toEqual({
      canExecute: true,
      state: "ready",
    });
  });
});
