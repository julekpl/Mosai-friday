import { describe, expect, it } from "vitest";

import {
  BOOT_BADGE,
  DISMISS_KEY_PREFIX,
  TILES_PER_PART,
  TILE_LAYOUT,
  bootHeading,
  bootPartState,
  checklistAnnouncement,
  checklistRows,
  isKitSettled,
  mosaicTiles,
  partFill,
  readDismissed,
  shouldShowBootloader,
  stepIndex,
  writeDismissed,
  type BootKit,
} from "@/components/app/kit/bootloader-model";
import { EXPLAINERS, nextExplainer } from "@/components/app/kit/explainers";
import { NEEDS_PLAN_CODE, STARTER_KIT_STALE_MS, STARTER_KIT_STEPS } from "@/shared/starterKitJob";
import type { StarterKitPart, StarterKitPartName } from "@/shared/starterKit";

/** U2e — the kit loader's pure mapping ("Mosaic assembles"). */

function part(overrides: Partial<StarterKitPart> = {}): StarterKitPart {
  return { status: "queued", outputs: [], attempts: 1, updatedAt: 0, ...overrides };
}

type Parts = Record<StarterKitPartName, StarterKitPart>;

function parts(overrides: Partial<Parts> = {}): Parts {
  return { plan: part(), site: part(), posts: part(), ...overrides };
}

const NOW = Date.UTC(2026, 8, 25, 12);

function kit(overrides: Partial<BootKit> = {}): BootKit {
  return { _id: "kit_1", status: "running", updatedAt: NOW, parts: parts(), ...overrides };
}

function count(tiles: ReturnType<typeof mosaicTiles>, name: StarterKitPartName, state: string) {
  return tiles.filter((tile) => tile.part === name && tile.state === state).length;
}

describe("part states", () => {
  it("maps job statuses to loader states", () => {
    expect(bootPartState(part({ status: "queued" }))).toBe("waiting");
    expect(bootPartState(part({ status: "running" }))).toBe("working");
    expect(bootPartState(part({ status: "succeeded" }))).toBe("done");
    expect(bootPartState(part({ status: "partially_succeeded" }))).toBe("partial");
    expect(bootPartState(part({ status: "failed" }))).toBe("failed");
    expect(bootPartState(part({ status: "canceled" }))).toBe("failed");
    expect(bootPartState(part({ status: "queued", errorCode: NEEDS_PLAN_CODE }))).toBe("locked");
  });

  it("a kit is settled only when no part is queued for work or running", () => {
    expect(isKitSettled(parts())).toBe(false);
    expect(isKitSettled(parts({ plan: part({ status: "succeeded" }), site: part({ status: "running" }) }))).toBe(false);
    expect(
      isKitSettled(
        parts({
          plan: part({ status: "succeeded" }),
          site: part({ status: "queued", errorCode: NEEDS_PLAN_CODE }),
          posts: part({ status: "failed" }),
        }),
      ),
    ).toBe(true);
    expect(
      isKitSettled(
        parts({
          plan: part({ status: "partially_succeeded" }),
          site: part({ status: "canceled" }),
          posts: part({ status: "succeeded" }),
        }),
      ),
    ).toBe(true);
  });
});

describe("tiles fill only from the job's real state", () => {
  it("has the same number of tiles per part", () => {
    for (const name of ["plan", "site", "posts"] as const) {
      expect(TILE_LAYOUT.filter((tile) => tile === name)).toHaveLength(TILES_PER_PART);
    }
  });

  it("knows each part's steps in the order the job writes them", () => {
    expect(stepIndex("plan", STARTER_KIT_STEPS.reading)).toBe(0);
    expect(stepIndex("plan", STARTER_KIT_STEPS.plan)).toBe(1);
    expect(stepIndex("site", STARTER_KIT_STEPS.site)).toBe(0);
    expect(stepIndex("posts", STARTER_KIT_STEPS.pictures)).toBe(1);
    expect(stepIndex("posts", "Something new")).toBeNull();
    expect(stepIndex("posts", undefined)).toBeNull();
  });

  it("a running part fills for the steps already done, and marks the next tile", () => {
    expect(partFill("plan", part({ status: "running", step: STARTER_KIT_STEPS.reading }))).toEqual({
      state: "working",
      total: 4,
      filled: 0,
      active: true,
    });
    expect(partFill("plan", part({ status: "running", step: STARTER_KIT_STEPS.plan })).filled).toBe(2);
    expect(partFill("posts", part({ status: "running", step: STARTER_KIT_STEPS.pictures })).filled).toBe(2);
    // No known step: nothing is filled, however long it has been running.
    expect(partFill("site", part({ status: "running" })).filled).toBe(0);
    expect(partFill("site", part({ status: "running", step: "Unknown step" })).filled).toBe(0);
  });

  it("finished parts fill fully, partial ones leave one gap, failed and locked fill none", () => {
    const tiles = mosaicTiles(
      parts({
        plan: part({ status: "succeeded" }),
        site: part({ status: "partially_succeeded", message: "No logo" }),
        posts: part({ status: "failed" }),
      }),
    );
    expect(tiles).toHaveLength(12);
    expect(count(tiles, "plan", "filled")).toBe(4);
    expect(count(tiles, "site", "filled")).toBe(3);
    expect(count(tiles, "site", "gap")).toBe(1);
    expect(count(tiles, "posts", "failed")).toBe(4);

    const locked = mosaicTiles(parts({ site: part({ status: "queued", errorCode: NEEDS_PLAN_CODE }) }));
    expect(count(locked, "site", "locked")).toBe(4);
  });

  it("a waiting kit has no filled or active tiles", () => {
    const tiles = mosaicTiles(parts());
    expect(tiles.every((tile) => tile.state === "empty")).toBe(true);
  });

  it("a running part shows exactly one active tile after its filled ones", () => {
    const tiles = mosaicTiles(parts({ plan: part({ status: "running", step: STARTER_KIT_STEPS.plan }) }));
    expect(count(tiles, "plan", "filled")).toBe(2);
    expect(count(tiles, "plan", "active")).toBe(1);
    expect(count(tiles, "plan", "empty")).toBe(1);
  });
});

describe("checklist rows", () => {
  it("show the job's step while working and the outcome once settled", () => {
    const rows = checklistRows(
      parts({
        plan: part({ status: "succeeded" }),
        site: part({ status: "running", step: STARTER_KIT_STEPS.site }),
        posts: part({ status: "queued" }),
      }),
    );
    expect(rows.map((row) => [row.title, row.badge, row.text])).toEqual([
      ["Your plan", "draft", "Your plan is ready"],
      ["Your website", "drafting", "Writing your homepage"],
      ["Your posts", "waiting", "Waiting to start"],
    ]);
  });

  it("a running part with no step yet says what it drafts, never a timer or percentage", () => {
    const [plan] = checklistRows(parts({ plan: part({ status: "running" }) }));
    expect(plan.text).toBe("Drafting your plan…");
    expect(plan.text).not.toMatch(/%|\d/);
  });

  it("failed, partial and locked rows say so in words", () => {
    const rows = checklistRows(
      parts({
        plan: part({ status: "failed", errorCode: "ai_budget" }),
        site: part({ status: "queued", errorCode: NEEDS_PLAN_CODE }),
        posts: part({ status: "partially_succeeded", message: "3 of 7 posts have pictures" }),
      }),
    );
    expect(rows[0]).toMatchObject({ state: "failed", badge: "failed" });
    expect(rows[0].text).toBe("We could not draft your plan. Your answers are saved.");
    expect(rows[1]).toMatchObject({ state: "locked", badge: "locked", text: "Needs the Starter plan" });
    expect(rows[2]).toMatchObject({ state: "partial", badge: "needs_a_fix" });
    expect(rows[2].text).toContain("3 of 7 posts have pictures");
  });

  it("never claims anything is live, published or sent", () => {
    const labels = Object.values(BOOT_BADGE).join(" ");
    expect(labels).not.toMatch(/\b(live|published|sent|scheduled)\b/);
  });
});

describe("announcements", () => {
  const running = checklistRows(parts({ site: part({ status: "running", step: STARTER_KIT_STEPS.site }) }));
  const heading = bootHeading(parts());

  it("say nothing on the first snapshot or when nothing changed", () => {
    expect(checklistAnnouncement(null, running, heading, false, false)).toBeNull();
    expect(checklistAnnouncement(running, [...running], heading, false, false)).toBeNull();
  });

  it("name only the parts that changed", () => {
    const next = checklistRows(
      parts({
        plan: part({ status: "succeeded" }),
        site: part({ status: "running", step: STARTER_KIT_STEPS.site }),
      }),
    );
    expect(checklistAnnouncement(running, next, heading, false, false)).toBe("Your plan: Your plan is ready.");
  });

  it("say the kit is ready when it settles", () => {
    const doneParts = parts({
      plan: part({ status: "succeeded" }),
      site: part({ status: "succeeded" }),
      posts: part({ status: "succeeded" }),
    });
    const text = checklistAnnouncement(running, checklistRows(doneParts), bootHeading(doneParts), false, true);
    expect(text).toContain("Your kit is ready.");
  });
});

describe("heading", () => {
  it("reads as working until settled, then ready, ready with gaps, or not finished", () => {
    expect(bootHeading(parts()).title).toBe("Making your starter kit");
    const ok = part({ status: "succeeded" });
    expect(bootHeading(parts({ plan: ok, site: ok, posts: ok }))).toMatchObject({ title: "Your kit is ready" });
    const partial = bootHeading(parts({ plan: ok, site: part({ status: "failed" }), posts: ok }));
    expect(partial.title).toBe("Your kit is ready");
    expect(partial.description).toContain("need a hand");
    const failed = part({ status: "failed" });
    expect(bootHeading(parts({ plan: failed, site: failed, posts: failed })).title).toBe("We could not finish your kit");
  });
});

describe("shouldShowBootloader", () => {
  const running = kit({ parts: parts({ site: part({ status: "running" }) }) });

  it("shows for a fresh queued or running kit", () => {
    expect(shouldShowBootloader(running, { now: NOW, dismissed: false })).toBe(true);
    expect(shouldShowBootloader(kit({ status: "queued" }), { now: NOW, dismissed: false })).toBe(true);
  });

  it("hides while loading, without a kit, and once this viewer closed it", () => {
    expect(shouldShowBootloader(undefined, { now: NOW, dismissed: false })).toBe(false);
    expect(shouldShowBootloader(null, { now: NOW, dismissed: false })).toBe(false);
    expect(shouldShowBootloader(running, { now: NOW, dismissed: true })).toBe(false);
  });

  it("hides for a kit hidden on the server", () => {
    expect(shouldShowBootloader({ ...running, dismissedAt: NOW }, { now: NOW, dismissed: false })).toBe(false);
  });

  it("hides for a finished, failed, partial or waiting kit", () => {
    for (const status of ["succeeded", "partially_succeeded", "failed", "waiting_for_user", "canceled"] as const) {
      expect(shouldShowBootloader({ ...running, status }, { now: NOW, dismissed: false })).toBe(false);
    }
  });

  it("hides for a stale kit that no run is working on", () => {
    const old = { ...running, updatedAt: NOW - STARTER_KIT_STALE_MS - 1 };
    expect(shouldShowBootloader(old, { now: NOW, dismissed: false })).toBe(false);
  });

  it("hides when every part is already settled even if the kit says running", () => {
    const done = part({ status: "succeeded" });
    expect(
      shouldShowBootloader(kit({ parts: parts({ plan: done, site: done, posts: done }) }), {
        now: NOW,
        dismissed: false,
      }),
    ).toBe(false);
  });
});

describe("per-viewer dismissal", () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      map,
    };
  }

  it("remembers the close per kit id", () => {
    const store = memory();
    expect(readDismissed(() => store, "kit_1")).toBe(false);
    writeDismissed(() => store, "kit_1");
    expect(store.map.get(`${DISMISS_KEY_PREFIX}kit_1`)).toBe("1");
    expect(readDismissed(() => store, "kit_1")).toBe(true);
    expect(readDismissed(() => store, "kit_2")).toBe(false);
  });

  it("works without storage: blocked, throwing or missing", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readDismissed(() => throwing, "kit_1")).toBe(false);
    expect(() => writeDismissed(() => throwing, "kit_1")).not.toThrow();
    expect(
      readDismissed(() => {
        throw new Error("SecurityError");
      }, "kit_1"),
    ).toBe(false);
    expect(readDismissed(() => null, "kit_1")).toBe(false);
  });
});

describe("explainers", () => {
  it("has 5 or 6 short cards in plain words, with no em dashes", () => {
    expect(EXPLAINERS.length).toBeGreaterThanOrEqual(5);
    expect(EXPLAINERS.length).toBeLessThanOrEqual(6);
    for (const card of EXPLAINERS) {
      expect(`${card.title} ${card.body}`).not.toMatch(/[—–]/);
      expect(card.body.length).toBeLessThan(160);
    }
  });

  it("wraps at both ends", () => {
    expect(nextExplainer(0, -1)).toBe(EXPLAINERS.length - 1);
    expect(nextExplainer(EXPLAINERS.length - 1, 1)).toBe(0);
    expect(nextExplainer(2, 1)).toBe(3);
  });
});
