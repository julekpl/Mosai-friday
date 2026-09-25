import { describe, expect, it } from "vitest";

import {
  getNextActionModel,
  isContactable,
  postCountsFrom,
  websiteStateFrom,
  type NextActionModel,
  type OutcomeSnapshot,
} from "@/components/app/next-action-model";

const allModules = ["understand", "journeys", "create", "build", "customers", "promote", "grow"];

/** Every outcome satisfied — the "nothing to do" state. */
const settled: OutcomeSnapshot = {
  modules: allModules,
  website: "live",
  posts: { drafts: 0, outThisWeek: 2 },
  contactable: true,
  resultsConnected: true,
};

const snap = (overrides: Partial<OutcomeSnapshot>): OutcomeSnapshot => ({ ...settled, ...overrides });
const without = (module: string) => allModules.filter((m) => m !== module);
const copy = (model: NextActionModel) =>
  [model.title, model.description, model.action.label, ...model.checklist.map((item) => item.detail)].join(" \n ");

describe("Home next step — outcome order", () => {
  it("1a: with no website draft, asks to make the website", () => {
    const model = getNextActionModel(snap({ website: "none", posts: undefined, contactable: false }));
    expect(model.key).toBe("website");
    expect(model.title).toBe("Make your website");
    expect(model.action).toEqual({ label: "Make your website", target: "build", emphasis: "primary" });
    expect(model.locked).toBe(false);
  });

  it("1b: with a draft, asks to publish it and shows it as a draft", () => {
    const model = getNextActionModel(snap({ website: "draft" }));
    expect(model.key).toBe("website");
    expect(model.title).toBe("Publish your website");
    expect(model.status).toEqual({ status: "draft" });
    expect(model.checklist[0]).toMatchObject({ state: "next", detail: "Draft, not published yet" });
    expect(copy(model)).not.toMatch(/\blive\b/i);
  });

  it("1c: an unknown website state is never read as live", () => {
    const model = getNextActionModel(snap({ website: undefined }));
    expect(model.key).toBe("website");
    expect(model.title).toBe("Check your website");
    expect(model.checklist[0].detail).toBe("Not checked yet");
  });

  it("2a: once the website is live, asks to use this week's draft posts", () => {
    const model = getNextActionModel(snap({ posts: { drafts: 3, outThisWeek: 0 } }));
    expect(model.key).toBe("posts");
    expect(model.title).toBe("Use or schedule this week's posts");
    expect(model.action.target).toBe("promote");
    expect(model.status).toEqual({ status: "draft", detail: "3 posts" });
    expect(model.checklist[0]).toMatchObject({ state: "has_record", detail: "Live at your address" });
  });

  it("2b: with no posts at all, asks to get posts ready", () => {
    const model = getNextActionModel(snap({ posts: { drafts: 0, outThisWeek: 0 } }));
    expect(model.key).toBe("posts");
    expect(model.title).toBe("Get this week's posts ready");
  });

  it("2c: unknown posts say 'Check your posts' and claim no number", () => {
    const model = getNextActionModel(snap({ posts: undefined }));
    expect(model.key).toBe("posts");
    expect(model.title).toBe("Check your posts");
    expect(model.description).not.toMatch(/\d/);
    expect(model.checklist[1].detail).toBe("Not checked yet");
  });

  it("3: missing contact details never trap the owner (no screen can add them yet; U6b)", () => {
    const model = getNextActionModel(snap({ contactable: false, resultsConnected: false }));
    expect(model.key).toBe("results");
    const contact = model.checklist.find((item) => item.key === "contact");
    expect(contact).toMatchObject({ state: "to_do", detail: "No phone, email or address saved" });
  });

  it("3b: unknown contact details count as not contactable, and 'done' does not claim people can reach you", () => {
    const model = getNextActionModel(snap({ contactable: undefined }));
    expect(model.checklist.find((item) => item.key === "contact")?.state).toBe("to_do");
    expect(model.key).toBe("done");
    expect(model.description).not.toMatch(/reach you/);
  });

  it("4: then asks to look at results, connecting Google", () => {
    const model = getNextActionModel(snap({ resultsConnected: false }));
    expect(model.key).toBe("results");
    expect(model.title).toBe("Look at your results");
    expect(model.action).toEqual({ label: "Connect Google", target: "grow", emphasis: "primary" });
  });

  it("4b: an unknown Google connection counts as not connected", () => {
    expect(getNextActionModel(snap({ resultsConnected: undefined })).key).toBe("results");
  });

  it("5: nothing to do shows 'You're set for this week' with one quiet link", () => {
    const model = getNextActionModel(settled);
    expect(model.key).toBe("done");
    expect(model.title).toBe("You're set for this week");
    expect(model.action.emphasis).toBe("quiet");
    expect(model.checklist.every((item) => item.state === "has_record")).toBe(true);
  });

  it("follows outcome order, never method order, even with no saved profiles", () => {
    const model = getNextActionModel(
      snap({ website: "none", personaCount: 0, journeyCount: 0, contentCount: 0 }),
    );
    expect(model.key).toBe("website");
    expect(copy(model)).not.toMatch(/persona|journey|workspace|provider|origin|audience profile/i);
  });
});

describe("Home next step — locked steps", () => {
  it("website: shows the step locked with a plain reason and links to plans", () => {
    const model = getNextActionModel(snap({ modules: without("build"), website: undefined }));
    expect(model).toMatchObject({ key: "website", locked: true, status: { status: "locked" } });
    expect(model.description).toMatch(/^Publishing needs the Starter plan/);
    expect(model.action).toEqual({ label: "See plans", target: "billing", emphasis: "primary" });
    expect(model.checklist[0].state).toBe("locked");
  });

  it("posts: shows the step locked instead of skipping ahead", () => {
    const model = getNextActionModel(snap({ modules: without("promote"), posts: undefined }));
    expect(model).toMatchObject({ key: "posts", locked: true });
    expect(model.description).toMatch(/^Posting needs the Starter plan/);
    expect(model.action.target).toBe("billing");
  });

  it("results: shows the step locked instead of 'You're set'", () => {
    const model = getNextActionModel(snap({ modules: without("grow"), resultsConnected: undefined }));
    expect(model).toMatchObject({ key: "results", locked: true });
    expect(model.description).toMatch(/Grow add-on/);
    expect(model.action.target).toBe("billing");
  });

  it("the core plan still sees one step: the locked website", () => {
    const model = getNextActionModel({
      modules: ["understand", "journeys", "create"],
      website: undefined,
      posts: undefined,
      contactable: undefined,
      resultsConnected: undefined,
    });
    expect(model.key).toBe("website");
    expect(model.locked).toBe(true);
    expect(model.checklist.map((item) => item.state)).toEqual(["locked", "locked", "to_do", "locked"]);
  });
});

describe("Home next step — reasons and truth", () => {
  it("uses saved profiles, maps and drafts only as reasons and deeper links", () => {
    const model = getNextActionModel(
      snap({ website: "draft", personaCount: 2, journeyCount: 1, contentCount: 4 }),
    );
    expect(model.key).toBe("website");
    expect(model.why).toEqual([
      "Written for the 2 customer types you saved.",
      "Follows the 1 customer path you mapped.",
      "4 drafts you can reuse.",
    ]);
    expect(model.deeper.map((link) => link.target)).toEqual(["understand", "journeys", "create"]);
  });

  it("has exactly one action in every state", () => {
    const states: OutcomeSnapshot[] = [
      snap({ website: "none" }),
      snap({ website: "draft" }),
      snap({ posts: undefined }),
      snap({ contactable: false }),
      snap({ resultsConnected: false }),
      settled,
      snap({ modules: without("build") }),
    ];
    for (const state of states) {
      const { action } = getNextActionModel(state);
      expect(typeof action.label).toBe("string");
      expect(action.label.length).toBeGreaterThan(0);
    }
  });

  it("never says complete or verified, and says live only when hosting proves it", () => {
    const unproven: OutcomeSnapshot[] = [
      snap({ website: "none" }),
      snap({ website: "draft" }),
      snap({ website: undefined }),
      snap({ modules: without("build"), website: undefined }),
    ];
    for (const state of unproven) {
      const text = copy(getNextActionModel(state));
      expect(text).not.toMatch(/complete|verified/i);
      expect(text).not.toMatch(/\blive\b/i);
    }
    for (const state of [settled, snap({ contactable: false }), snap({ resultsConnected: false })]) {
      expect(copy(getNextActionModel(state))).not.toMatch(/complete|verified/i);
    }
  });
});

describe("Home next step — snapshot helpers", () => {
  it("website is live only when the hosting status says live", () => {
    const builds = [{ kind: "website" }];
    expect(websiteStateFrom(builds, { state: "live" })).toBe("live");
    expect(websiteStateFrom(builds, { state: "deploying" })).toBe("draft");
    expect(websiteStateFrom(builds, { state: "failed" })).toBe("draft");
    expect(websiteStateFrom(builds, { state: "not_deployed" })).toBe("draft");
    expect(websiteStateFrom(builds, null)).toBe("draft");
    expect(websiteStateFrom([{ kind: "app" }], { state: "not_deployed" })).toBe("none");
    expect(websiteStateFrom(undefined, undefined)).toBeUndefined();
  });

  it("counts a published post only with a receipt from this week", () => {
    const now = 1_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    expect(
      postCountsFrom(
        [
          { status: "draft" },
          { status: "draft" },
          { status: "scheduled" },
          { status: "published", providerRef: "fb_123", publishedAt: now - day },
          { status: "published", publishedAt: now - day },
          { status: "published", providerRef: "fb_old", publishedAt: now - 10 * day },
          { status: "failed" },
        ],
        now,
      ),
    ).toEqual({ drafts: 2, outThisWeek: 2 });
    expect(postCountsFrom(undefined, now)).toBeUndefined();
  });

  it("contactable needs a saved phone, email or address", () => {
    expect(isContactable(undefined)).toBeUndefined();
    expect(isContactable(null)).toBe(false);
    expect(isContactable({})).toBe(false);
    expect(isContactable({ websiteScan: { businessDetails: { phone: "  " } } })).toBe(false);
    expect(isContactable({ websiteScan: { businessDetails: { email: "hi@example.com" } } })).toBe(true);
    expect(isContactable({ websiteScan: { gmb: { address: "1 High St" } } })).toBe(true);
  });
});
