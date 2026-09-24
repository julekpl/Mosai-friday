/**
 * Publish-to-web display rules (owner decision 24 Sep 2026). The UI may say
 * "Live" only when the hosting status reports `state === "live"`
 * (AGENTS.md rule 5), and must never render an unexpected path as a link.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  deployWebsiteAction,
  hostingStateView,
  needsPreparedRelease,
  publicSiteUrl,
  publishButtonLabel,
  siteHostingStatusQuery,
} from "@/components/build/publishToWebState";

describe("hostingStateView", () => {
  it("says Live only for state live", () => {
    expect(hostingStateView({ state: "live", error: null })).toEqual({
      tone: "live",
      text: "Live",
      isLive: true,
    });
    for (const state of ["not_deployed", "deploying", "failed"] as const) {
      const view = hostingStateView({ state, error: null });
      expect(view.isLive).toBe(false);
      expect(view.text).not.toMatch(/live/i);
      expect(view.tone).not.toBe("live");
    }
  });

  it("uses the honest wording for each state", () => {
    expect(hostingStateView(undefined).text).toBe("Not on the web yet");
    expect(hostingStateView({ state: "not_deployed", error: null }).text).toBe(
      "Not on the web yet",
    );
    expect(hostingStateView({ state: "deploying", error: null }).text).toBe("Publishing…");
    expect(hostingStateView({ state: "failed", error: "No pages" }).text).toBe(
      "Publish failed: No pages",
    );
    expect(hostingStateView({ state: "failed", error: null }).text).toBe("Publish failed");
  });
});

describe("publicSiteUrl", () => {
  it("builds the full address from the status path", () => {
    expect(publicSiteUrl("https://appmosai.com", "/s/acme-website")).toBe(
      "https://appmosai.com/s/acme-website",
    );
    expect(publicSiteUrl("https://appmosai.com/", "/s/acme-website/about")).toBe(
      "https://appmosai.com/s/acme-website/about",
    );
  });

  it("uses an absolute https address from MOSAI_PUBLIC_SITE_BASE as is", () => {
    expect(
      publicSiteUrl("https://appmosai.com", "https://appmosai.site/s/acme-website"),
    ).toBe("https://appmosai.site/s/acme-website");
    expect(publicSiteUrl("https://appmosai.com", "http://appmosai.site/s/acme-website")).toBeNull();
    expect(publicSiteUrl("https://appmosai.com", "https://appmosai.site/admin")).toBeNull();
  });

  it("ignores missing or unexpected paths", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "/app/x",
      "https://evil.example/s/acme-website",
      "//evil.example/s/acme-website",
      "/s/acme-app",
      "/s/acme-website/../../app",
      "javascript:alert(1)",
    ]) {
      expect(publicSiteUrl("https://appmosai.com", bad)).toBeNull();
    }
  });
});

describe("publish helpers", () => {
  it("labels the button by whether the site was deployed before", () => {
    expect(publishButtonLabel(undefined)).toBe("Publish to web");
    expect(publishButtonLabel({ state: "not_deployed", lastDeployedAt: null })).toBe(
      "Publish to web",
    );
    expect(publishButtonLabel({ state: "live", lastDeployedAt: 1 })).toBe("Update live site");
    expect(publishButtonLabel({ state: "failed", lastDeployedAt: 1 })).toBe("Update live site");
  });

  it("recognises a missing prepared release", () => {
    expect(needsPreparedRelease("Prepare a release first.")).toBe(true);
    expect(needsPreparedRelease("No prepared release for this site")).toBe(true);
    expect(needsPreparedRelease("The release is not prepared")).toBe(true);
    expect(needsPreparedRelease("Network error")).toBe(false);
  });

  it("calls the agreed backend contract by name", () => {
    expect(getFunctionName(siteHostingStatusQuery)).toBe("siteHosting:status");
    expect(getFunctionName(deployWebsiteAction)).toBe("siteHosting:deployWebsite");
  });

  it("opens public links without an opener or referrer", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../src/components/build/PublishToWeb.tsx"),
      "utf8",
    );
    const blankTargets = source.match(/target="_blank"/g) ?? [];
    const safeRels = source.match(/rel="noopener noreferrer"/g) ?? [];
    expect(blankTargets.length).toBeGreaterThan(0);
    expect(safeRels.length).toBe(blankTargets.length);
  });
});

describe("SPA routes", () => {
  it("never renders dashboard UI under /s/*", () => {
    const main = readFileSync(path.resolve(__dirname, "../../src/main.tsx"), "utf8");
    expect(main).toMatch(/<Route path="\/s\/\*" element={<PublicSiteDevNotice \/>} \/>/);
  });
});
