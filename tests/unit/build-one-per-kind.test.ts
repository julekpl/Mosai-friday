import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedUser, type Tenant } from "./helpers";

/**
 * Owner decision (24 Sep 2026): "each project may have one site and one app
 * at the moment." `builds.create` enforces it on the server; the Build page
 * shows a Website slot and an App slot. Projects that already hold several
 * builds of one kind keep them (no deletion without owner approval): the
 * most recently updated one fills the slot and the rest sit under
 * "Older builds".
 *
 * Red-first record (24 Sep 2026): on the unfixed tree the second website and
 * the second app were both inserted, the concurrent pair both succeeded,
 * `buildSlots` did not exist, and the Build page rendered a free-form list
 * with a "New build" button instead of the two slots.
 */

/* ── Server: builds.create ─────────────────────────────────────────────── */

async function ownerWithProject() {
  const t = newBackend();
  const owner = await seedUser(t, { plan: "starter" });
  const projectId = await owner.as.mutation(api.projects.create, { name: "Bakery" });
  return { t, owner, projectId };
}

function createBuild(
  tenant: Tenant,
  projectId: Id<"projects">,
  kind: "website" | "app",
  name = kind === "website" ? "Website" : "App",
) {
  return tenant.as.mutation(api.builds.create, { projectId, name, kind });
}

describe("builds.create: one website and one app per project", () => {
  it("refuses a second website in the same project", async () => {
    const { t, owner, projectId } = await ownerWithProject();
    await createBuild(owner, projectId, "website");
    await expect(createBuild(owner, projectId, "website", "Second")).rejects.toThrow(
      /already has a website/,
    );
    const rows = await t.run((ctx) => ctx.db.query("builds").collect());
    expect(rows.filter((r) => r.kind === "website")).toHaveLength(1);
  });

  it("refuses a second app in the same project", async () => {
    const { t, owner, projectId } = await ownerWithProject();
    await createBuild(owner, projectId, "app");
    await expect(createBuild(owner, projectId, "app", "Second")).rejects.toThrow(
      /already has an app/,
    );
    const rows = await t.run((ctx) => ctx.db.query("builds").collect());
    expect(rows.filter((r) => r.kind === "app")).toHaveLength(1);
  });

  it("allows one website and one app side by side", async () => {
    const { owner, projectId } = await ownerWithProject();
    await createBuild(owner, projectId, "website");
    await createBuild(owner, projectId, "app");
    const rows = await owner.as.query(api.builds.list, { projectId });
    expect(rows.map((r) => r.kind).sort()).toEqual(["app", "website"]);
  });

  it("the slot is per project: another project of the same owner is free", async () => {
    const { owner, projectId } = await ownerWithProject();
    await createBuild(owner, projectId, "website");
    const other = await owner.as.mutation(api.projects.create, { name: "Second shop" });
    await expect(createBuild(owner, other, "website")).resolves.toBeTruthy();
  });

  it("deleting the build frees the slot", async () => {
    const { owner, projectId } = await ownerWithProject();
    const first = await createBuild(owner, projectId, "website");
    await owner.as.mutation(api.builds.remove, { id: first });
    const second = await createBuild(owner, projectId, "website", "Fresh start");
    expect(second).not.toBe(first);

    const app = await createBuild(owner, projectId, "app");
    await owner.as.mutation(api.builds.remove, { id: app });
    await expect(createBuild(owner, projectId, "app")).resolves.toBeTruthy();
  });

  it("two concurrent creates of the same kind cannot both succeed", async () => {
    const { t, owner, projectId } = await ownerWithProject();
    const results = await Promise.allSettled([
      createBuild(owner, projectId, "website", "A"),
      createBuild(owner, projectId, "website", "B"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason)).toMatch(
      /already has a website/,
    );
    const rows = await t.run((ctx) => ctx.db.query("builds").collect());
    expect(rows).toHaveLength(1);
  });

  it("another tenant cannot create a build in someone else's project", async () => {
    const { t, owner, projectId } = await ownerWithProject();
    const stranger = await seedUser(t, { plan: "starter" });
    await expect(createBuild(stranger, projectId, "website")).rejects.toThrow();
    // …and an empty slot is not an opening: the owner's project stays empty
    // and the refusal is an access error, not the slot message.
    await expect(createBuild(stranger, projectId, "app")).rejects.not.toThrow(
      /already has/,
    );
    const rows = await t.run((ctx) => ctx.db.query("builds").collect());
    expect(rows).toHaveLength(0);
    await expect(createBuild(owner, projectId, "website")).resolves.toBeTruthy();
  });

  it("legacy projects with several builds of a kind keep them all and cannot add more", async () => {
    const { t, owner, projectId } = await ownerWithProject();
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const name of ["Old A", "Old B"]) {
        await ctx.db.insert("builds", {
          projectId,
          name,
          kind: "website",
          status: "draft",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    await expect(createBuild(owner, projectId, "website")).rejects.toThrow(
      /already has a website/,
    );
    const rows = await owner.as.query(api.builds.list, { projectId });
    expect(rows).toHaveLength(2);
  });
});

/* ── UI helper: which build fills each slot ────────────────────────────── */

import { buildSlots } from "@/components/build/buildSelection";

describe("buildSlots picks the primary build per kind", () => {
  const row = (
    _id: string,
    kind: "website" | "app",
    createdAt: number,
    updatedAt?: number,
  ) => ({ _id, kind, createdAt, updatedAt });

  it("returns empty slots for a project without builds", () => {
    expect(buildSlots([])).toEqual({
      website: { primary: null, older: [] },
      app: { primary: null, older: [] },
    });
  });

  it("uses the one build of each kind", () => {
    const slots = buildSlots([row("w", "website", 1, 1), row("a", "app", 2, 2)]);
    expect(slots.website).toEqual({ primary: row("w", "website", 1, 1), older: [] });
    expect(slots.app).toEqual({ primary: row("a", "app", 2, 2), older: [] });
  });

  it("shows the most recently updated build and lists the rest newest first", () => {
    const slots = buildSlots([
      row("created_last", "website", 300, 300),
      row("edited_last", "website", 100, 900),
      row("oldest", "website", 50, 60),
      row("app", "app", 10, 10),
    ]);
    expect(slots.website.primary?._id).toBe("edited_last");
    expect(slots.website.older.map((b) => b._id)).toEqual(["created_last", "oldest"]);
    expect(slots.app.primary?._id).toBe("app");
    expect(slots.app.older).toEqual([]);
  });

  it("falls back to createdAt and is stable on ties", () => {
    const slots = buildSlots([
      row("b", "app", 5),
      row("a", "app", 5),
      row("c", "app", 9),
    ]);
    expect(slots.app.primary?._id).toBe("c");
    expect(slots.app.older.map((x) => x._id)).toEqual(["b", "a"]);
  });
});

/* ── UI: the Build page renders two slots ──────────────────────────────── */

const queryResults = vi.hoisted(() => new Map<string, unknown>());

vi.mock("convex/react", async () => {
  const { getFunctionName: name } = await import("convex/server");
  return {
    useQuery: (ref: Parameters<typeof name>[0]) => queryResults.get(name(ref)),
    useMutation: () => async () => undefined,
    useAction: () => async () => undefined,
  };
});

vi.mock("@/components/build/BuildWorkspace", () => ({
  BuildWorkspace: ({ build }: { build: { name: string } }) =>
    createElement("div", null, `workspace:${build.name}`),
}));

vi.mock("@/components/build/AppWorkspace", () => ({
  AppWorkspace: ({ build }: { build: { name: string } }) =>
    createElement("div", null, `app:${build.name}`),
}));

vi.mock("@/components/app/ContextInspector", () => ({
  ContextInspector: () => null,
}));

const { default: Build } = await import("@/pages/app/Build");

function renderBuild(url = "/app/project_1/build") {
  return renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: [url] },
      createElement(Build, { projectId: "project_1" as never }),
    ),
  );
}

const LIST = getFunctionName(api.builds.list);
const MATRIX = getFunctionName(api.entitlements.matrix);

const build = (
  _id: string,
  name: string,
  kind: "website" | "app",
  updatedAt: number,
) => ({
  _id,
  projectId: "project_1",
  name,
  kind,
  status: "draft",
  createdAt: 1_700_000_000_000,
  updatedAt,
});

beforeEach(() => {
  queryResults.clear();
  queryResults.set(MATRIX, {
    plan: "starter",
    role: "owner",
    country: "Default",
    modules: [{ module: "build", label: "Build", state: "included" }],
  });
});

describe("Build page slots", () => {
  it("empty project: a Website slot and an App slot, each with one create action", () => {
    queryResults.set(LIST, []);
    const markup = renderBuild();
    expect(markup).toContain(">Website</h2>");
    expect(markup).toContain(">App</h2>");
    expect(markup).toContain("Create website");
    expect(markup).toContain("Create app");
    expect(markup).not.toContain("New build");
    expect(markup).not.toContain("Older builds");
  });

  it("loading: a busy status, not an empty state", () => {
    const markup = renderBuild();
    expect(markup).toContain('aria-busy="true"');
    expect(markup).not.toContain("Create website");
  });

  it("filled slots show the build card with open, rename and delete", () => {
    queryResults.set(LIST, [
      build("w1", "Bakery site", "website", 2),
      build("a1", "Booking app", "app", 2),
    ]);
    const markup = renderBuild();
    for (const name of ["Bakery site", "Booking app"]) {
      expect(markup).toContain(`aria-label="Open ${name}"`);
      expect(markup).toContain(`aria-label="Rename ${name}"`);
      expect(markup).toContain(`aria-label="Delete ${name}"`);
    }
    expect(markup).not.toContain("Create website");
    expect(markup).not.toContain("Create app");
  });

  it("legacy duplicates: newest fills the slot, the others sit under Older builds", () => {
    queryResults.set(LIST, [
      build("w_old", "First site", "website", 10),
      build("w_new", "Current site", "website", 20),
    ]);
    const markup = renderBuild();
    expect(markup).toContain('aria-label="Open Current site"');
    expect(markup).not.toContain('aria-label="Open First site"');
    expect(markup).toContain("Older builds (1)");
    const older = markup.slice(markup.indexOf("Older builds"));
    expect(older).toContain("First site");
    expect(older).toContain('aria-label="Delete First site"');
    // The app slot is still empty and still offers its create action.
    expect(markup).toContain("Create app");
    expect(markup).not.toContain("Create website");
  });

  it("?build= still opens a build, including an older one", () => {
    queryResults.set(LIST, [
      build("w_old", "First site", "website", 10),
      build("w_new", "Current site", "website", 20),
    ]);
    expect(renderBuild("/app/project_1/build?build=w_old")).toContain("workspace:First site");
    expect(renderBuild("/app/project_1/build?build=w_new")).toContain("workspace:Current site");
  });

  it("locked: shows the plan state instead of create actions", () => {
    queryResults.set(LIST, []);
    queryResults.set(MATRIX, {
      plan: "free",
      role: "owner",
      country: "Default",
      modules: [{ module: "build", label: "Build", state: "locked" }],
    });
    const markup = renderBuild();
    expect(markup).toContain("Build is not on your plan");
    expect(markup).toContain('href="/app/billing"');
    expect(markup).not.toContain("Create website");
  });
});
