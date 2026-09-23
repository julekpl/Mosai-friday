import { describe, expect, it } from "vitest";
import { resolveAuthReturnTo } from "../../src/lib/auth-return-to";

describe("BP-02 auth return path", () => {
  it("keeps dashboard and nested application targets local", () => {
    expect(resolveAuthReturnTo("/dashboard?view=recent")).toBe(
      "/dashboard?view=recent",
    );
    expect(resolveAuthReturnTo("/app/project-1/build")).toBe(
      "/app/project-1/build",
    );
  });

  it("keeps safe local module paths, query strings and fragments", () => {
    expect(resolveAuthReturnTo("/app/project-1/build?tab=pages#editor")).toBe(
      "/app/project-1/build?tab=pages#editor",
    );
  });

  it.each([
    "https://attacker.example/app",
    "//attacker.example/app",
    "/\\attacker.example/app",
    "/auth",
    "/shop/store-1",
    "javascript:alert(1)",
  ])("falls back for disallowed target %s", (candidate) => {
    expect(resolveAuthReturnTo(candidate)).toBe("/dashboard");
  });

  it("also validates the configured fallback", () => {
    expect(resolveAuthReturnTo(null, "//attacker.example")).toBe("/dashboard");
  });
});
