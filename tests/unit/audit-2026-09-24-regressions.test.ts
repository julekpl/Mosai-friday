import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * Regressions for defects found in the 24 Sep 2026 readiness audit.
 *
 *  1. `buildChat.editPage` authorized the build but loaded the client-supplied
 *     `pageId` without checking its project, so a Build-plan user could have
 *     the AI rewrite another tenant's CMS draft (and read its blocks back).
 *  2. `posts.update` let the client move a draft straight to
 *     `status: "published"` (no provider receipt, AGENTS.md rule 5) or
 *     `"scheduled"` (bypassing `promote.publish`).
 *
 * Network policy: `fetch` is stubbed to throw, so no AI provider can be
 * contacted; the cross-tenant call must be refused before any model call.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function blockNetwork(): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    throw new Error(`live network blocked in tests: ${url}`);
  });
  return calls;
}

async function seedPage(
  t: TestBackend,
  tenant: Tenant,
  projectId: string,
): Promise<{ pageId: string; revisionId: string }> {
  const now = Date.now();
  const siteId = await t.run((ctx) =>
    ctx.db.insert("sites", {
      projectId,
      name: "Website",
      slug: "website",
      status: "draft",
      createdBy: tenant.userId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const pageId = await t.run((ctx) =>
    ctx.db.insert("cmsPages", {
      siteId,
      projectId,
      title: "Home",
      slug: "home",
      fullPath: "/",
      status: "draft",
      createdBy: tenant.userId,
      createdAt: now,
      updatedAt: now,
    }),
  );
  const revisionId = await t.run((ctx) =>
    ctx.db.insert("pageRevisions", {
      pageId,
      projectId,
      version: 1,
      state: "draft",
      document: {
        schemaVersion: 1,
        blocks: [{ id: "blk_victim", type: "hero", version: 1, props: { heading: "Victim copy" } }],
      },
      createdBy: tenant.userId,
      createdAt: now,
    }),
  );
  await t.run((ctx) => ctx.db.patch(pageId, { latestDraftRevisionId: revisionId }));
  return { pageId, revisionId };
}

describe("buildChat.editPage stays inside the build's project", () => {
  it("refuses a page that belongs to another tenant, before any AI call or write", async () => {
    const calls = blockNetwork();
    const t = newBackend();
    const attacker = await seedUser(t, { plan: "starter" });
    const victim = await seedUser(t, { plan: "starter" });

    const attackerProject = await attacker.as.mutation(api.projects.create, { name: "a" });
    const buildId = await attacker.as.mutation(api.builds.create, {
      projectId: attackerProject,
      name: "Website",
      kind: "website",
    });
    const victimProject = await victim.as.mutation(api.projects.create, { name: "v" });
    const { pageId, revisionId } = await seedPage(t, victim, victimProject);

    await expect(
      attacker.as.action(api.buildChat.editPage, {
        buildId,
        message: "Replace everything with my text",
        pageId,
      }),
    ).rejects.toThrow(/Page not found/);

    expect(calls).toEqual([]);
    const rev = await t.run((ctx) => ctx.db.get(revisionId));
    expect(rev?.document.blocks[0]?.props).toEqual({ heading: "Victim copy" });
    const messages = await t.run((ctx) =>
      ctx.db
        .query("buildMessages")
        .collect(),
    );
    expect(messages.filter((m) => m.buildId === buildId)).toEqual([]);
  });
});

describe("posts.update cannot write a status", () => {
  it("rejects a client-asserted published or scheduled status and writes nothing", async () => {
    const t = newBackend();
    const tenant = await seedUser(t, { plan: "starter" });
    const projectId = await tenant.as.mutation(api.projects.create, { name: "p" });
    const postId = await tenant.as.mutation(api.posts.create, {
      projectId,
      channel: "linkedin",
      body: "Hello",
    });

    for (const status of ["published", "scheduled"] as const) {
      await expect(
        tenant.as.mutation(api.posts.update, {
          id: postId,
          // @ts-expect-error — status is no longer a client input
          status,
        }),
      ).rejects.toThrow();
    }

    // Legitimate draft edits keep working.
    await tenant.as.mutation(api.posts.update, { id: postId, body: "Edited" });
    const post = await t.run((ctx) => ctx.db.get(postId));
    expect(post?.status).toBe("draft");
    expect(post?.body).toBe("Edited");
  });
});
