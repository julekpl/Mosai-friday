import { describe, expect, it } from "vitest";

import {
  BADGE_LABEL,
  DRAFT_SITE_LINE,
  cardState,
  httpsUrl,
  kitAnnouncement,
  kitCardCopy,
  liveSiteAddress,
} from "@/components/app/kit/kit-model";
import { NEEDS_PLAN_CODE, NEEDS_PLAN_MESSAGE, STARTER_KIT_STEPS } from "@/shared/starterKitJob";
import type { StarterKitPart } from "@/shared/starterKit";

/** U4 — the kit screen's state-to-copy mapping (first-run blueprint §3). */

function part(overrides: Partial<StarterKitPart>): StarterKitPart {
  return { status: "queued", outputs: [], attempts: 1, updatedAt: 0, ...overrides };
}

const FORBIDDEN = /\b(live|published|sent|scheduled|persona|journey|workspace|provider)\b/i;

describe("kit card states", () => {
  it("queued and running show the drafting line with the job's real step, no timer", () => {
    const queued = kitCardCopy("site", part({ status: "queued" }));
    expect(queued).toEqual({ state: "working", badge: "drafting", headline: "Drafting your website…" });

    const running = kitCardCopy("site", part({ status: "running", step: STARTER_KIT_STEPS.site }));
    expect(running.headline).toBe("Drafting your website…");
    expect(running.detail).toBe("Writing your homepage");
    expect(`${running.headline} ${running.detail}`).not.toMatch(/%|\d+\s*(s|sec|seconds|min)\b/);

    expect(kitCardCopy("plan", part({ status: "running" })).headline).toBe("Drafting your plan…");
    expect(kitCardCopy("posts", part({ status: "running" })).headline).toBe("Drafting your posts…");
  });

  it("succeeded is a draft, never live", () => {
    const copy = kitCardCopy("site", part({ status: "succeeded" }));
    expect(copy.state).toBe("succeeded");
    expect(copy.badge).toBe("draft");
    expect(copy.headline).toBe("Your website draft is ready");
    expect(copy.headline).not.toMatch(FORBIDDEN);
  });

  it("partially_succeeded names the gap from the server", () => {
    const copy = kitCardCopy(
      "posts",
      part({ status: "partially_succeeded", message: "3 of 7 posts have pictures; add your own for the rest" }),
    );
    expect(copy.state).toBe("partially_succeeded");
    expect(copy.detail).toBe("3 of 7 posts have pictures; add your own for the rest");
  });

  it("failed keeps the answers and offers a retry", () => {
    for (const status of ["failed", "canceled"] as const) {
      const copy = kitCardCopy("plan", part({ status, errorCode: "ai_budget" }));
      expect(copy.state).toBe("failed");
      expect(copy.headline).toBe("We could not draft your plan. Your answers are saved.");
    }
  });

  it("a queued part waiting for a plan is locked", () => {
    expect(cardState(part({ status: "queued", errorCode: NEEDS_PLAN_CODE }))).toBe("locked");
    expect(kitCardCopy("posts", part({ status: "queued", errorCode: NEEDS_PLAN_CODE })).headline).toBe(
      NEEDS_PLAN_MESSAGE,
    );
    // The code only locks a queued part.
    expect(cardState(part({ status: "failed", errorCode: NEEDS_PLAN_CODE }))).toBe("failed");
  });

  it("no badge claims an outside confirmation", () => {
    for (const label of Object.values(BADGE_LABEL)) {
      expect(label.replace(/_/g, " ")).not.toMatch(FORBIDDEN);
    }
  });
});

describe("kit announcements", () => {
  it("announces only finished parts", () => {
    expect(kitAnnouncement("site", part({ status: "running" }))).toBeNull();
    expect(kitAnnouncement("site", part({ status: "queued", errorCode: NEEDS_PLAN_CODE }))).toBeNull();
    expect(kitAnnouncement("site", part({ status: "succeeded" }))).toBe("Your website draft is ready.");
    expect(kitAnnouncement("plan", part({ status: "failed" }))).toBe(
      "We could not draft your plan. Your answers are saved.",
    );
    expect(kitAnnouncement("posts", part({ status: "partially_succeeded", message: "2 posts have no picture" }))).toBe(
      "Your posts are ready to use, with one gap: 2 posts have no picture",
    );
  });
});

describe("website address", () => {
  const origin = "https://app.example.test";

  it("shows an address only when hosting says live", () => {
    const path = "/s/northwind-website";
    expect(liveSiteAddress({ state: "live", path }, origin)).toBe("https://app.example.test/s/northwind-website");
    for (const state of ["not_deployed", "deploying", "failed"] as const) {
      expect(liveSiteAddress({ state, path }, origin)).toBeNull();
    }
    expect(liveSiteAddress(undefined, origin)).toBeNull();
    expect(liveSiteAddress(null, origin)).toBeNull();
    expect(DRAFT_SITE_LINE).toBe("Draft · not on the web yet");
  });

  it("refuses addresses that are not a public site path or https", () => {
    expect(liveSiteAddress({ state: "live", path: "/s/../admin-website" }, origin)).toBeNull();
    expect(liveSiteAddress({ state: "live", path: "javascript:alert(1)" }, origin)).toBeNull();
    expect(liveSiteAddress({ state: "live", path: "http://sites.example.test/s/a-website" }, origin)).toBeNull();
    expect(liveSiteAddress({ state: "live", path: "https://sites.example.test/s/a-website" }, origin)).toBe(
      "https://sites.example.test/s/a-website",
    );
  });

  it("only https URLs become links or pictures", () => {
    expect(httpsUrl("https://images.example.test/a.jpg")).toBe("https://images.example.test/a.jpg");
    expect(httpsUrl("http://images.example.test/a.jpg")).toBeUndefined();
    expect(httpsUrl("javascript:alert(1)")).toBeUndefined();
    expect(httpsUrl(undefined)).toBeUndefined();
  });
});
