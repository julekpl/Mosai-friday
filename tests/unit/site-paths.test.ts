import { describe, expect, it } from "vitest";
import {
  MAX_SITE_PATH_DEPTH,
  normalizeSitePath,
  parentSitePath,
  slugForSitePath,
} from "@/convex/lib/sitePaths";

/**
 * The one site-path normalizer (build backend review C3). Before it existed,
 * `generateSite` kept `/` while `ensureSiteWithPages` turned it into `-`, so
 * nested and trailing-slash paths were created under one path and looked up
 * under another, and their content was lost.
 */
describe("normalizeSitePath", () => {
  it("keeps the homepage as /", () => {
    expect(normalizeSitePath("/")).toBe("/");
    expect(normalizeSitePath("")).toBe("/");
    expect(normalizeSitePath("  ")).toBe("/");
    expect(normalizeSitePath("//")).toBe("/");
    expect(normalizeSitePath(undefined)).toBe("/");
  });

  it("keeps nested segments and drops trailing or doubled slashes", () => {
    expect(normalizeSitePath("/services/web-design")).toBe("/services/web-design");
    expect(normalizeSitePath("/about/")).toBe("/about");
    expect(normalizeSitePath("services//web design/")).toBe("/services/web-design");
  });

  it("normalizes each segment like a CMS slug", () => {
    expect(normalizeSitePath("/Our Story!")).toBe("/our-story");
    expect(normalizeSitePath("/--Pricing & Plans--/")).toBe("/pricing-plans");
    expect(normalizeSitePath(`/${"a".repeat(120)}`)).toBe(`/${"a".repeat(80)}`);
  });

  it("falls back to the page name when the path is missing", () => {
    expect(normalizeSitePath(undefined, "About Us")).toBe("/about-us");
    expect(normalizeSitePath("", "Contact")).toBe("/contact");
  });

  it("caps the depth at the CMS page-tree limit", () => {
    const deep = "/a/b/c/d/e/f/g";
    expect(normalizeSitePath(deep).split("/").filter(Boolean)).toHaveLength(MAX_SITE_PATH_DEPTH);
  });

  it("is idempotent", () => {
    for (const raw of ["/", "/about/", "Services / Web Design", "/x//y/"]) {
      const once = normalizeSitePath(raw);
      expect(normalizeSitePath(once)).toBe(once);
    }
  });
});

describe("slugForSitePath / parentSitePath", () => {
  it("derives the slug and parent from a normalized path", () => {
    expect(slugForSitePath("/")).toBe("home");
    expect(slugForSitePath("/about")).toBe("about");
    expect(slugForSitePath("/services/web-design")).toBe("web-design");
    expect(parentSitePath("/")).toBeNull();
    expect(parentSitePath("/about")).toBe("/");
    expect(parentSitePath("/services/web-design")).toBe("/services");
  });
});
