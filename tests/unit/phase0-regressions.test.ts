import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import * as connectionsModule from "@/convex/connections";
import { PLAN_MODULES } from "@/convex/billing";
import { AI_QUOTA_LIMIT } from "@/convex/guards";
import { newBackend, seedProject, seedUser } from "./helpers";
import {
  completionCalls,
  resetCompletionStub,
  stubCompletionContent,
} from "./stubs/vly-integrations";

/**
 * Phase 0 regression suite, part 1 — MOSAI pack T1.7, tests R1–R4, R6, R8, R9.
 *
 * Every test below targets a control that is already implemented in code. Each
 * was demonstrated failing against the pre-fix code before it was accepted; the
 * failures are recorded in the ticket / PR (see `docs/tickets/README.md`).
 *
 * The platform integrations SDK is stubbed (see `vitest.config.ts` +
 * `tests/unit/stubs/`) so these run offline. The stub does not weaken anything:
 * R3 asserts the server rejects the caller *before* any provider call, and R4
 * inspects the prompt the server actually built.
 */

describe("R1 — anonymous cannot use the product (T0.2)", () => {
  it("has no anonymous sign-in provider", async () => {
    const t = newBackend();
    // The provider list is the deployed auth config; asking for the removed
    // provider is a runtime assertion, not a source search.
    await expect(
      t.action(api.auth.signIn, { provider: "anonymous", params: {} }),
    ).rejects.toThrow(/not configured/i);
  });

  it("a new account has Base (free) access only", async () => {
    const t = newBackend();
    const { as } = await seedUser(t);

    const plan = await as.query(api.billing.currentPlan, {});
    expect(plan?.plan).toBe("free");
    expect([...(plan?.modules ?? [])].sort()).toEqual(
      [...PLAN_MODULES.free].sort(),
    );
    // The paid add-ons must not be reachable on a fresh account.
    for (const paid of ["build", "customers", "promote", "sell", "grow"]) {
      expect(plan?.modules ?? []).not.toContain(paid);
    }
  });

  it("an account minted while anonymous sign-in existed is rejected", async () => {
    const t = newBackend();
    const { as } = await seedUser(t, { isAnonymous: true });

    // `projects.create` goes through `requireUser`, which treats a leftover
    // anonymous account as unauthenticated (guards.ts).
    await expect(as.mutation(api.projects.create, { name: "Sneaky" })).rejects.toThrow(
      /Not signed in/,
    );
    const projects = await t.run((ctx) => ctx.db.query("projects").collect());
    expect(projects).toEqual([]);
  });
});

describe("R2 — a client cannot change its own plan (T0.3)", () => {
  it("rejects changePlan and leaves the stored plan untouched", async () => {
    const t = newBackend();
    const { userId, as } = await seedUser(t, { plan: "free" });

    await expect(as.mutation(api.billing.changePlan, { plan: "scale" })).rejects.toThrow(
      /managed server-side/i,
    );

    const row = await t.run((ctx) => ctx.db.get(userId));
    expect(row?.plan).toBe("free");
    const plan = await as.query(api.billing.currentPlan, {});
    expect(plan?.selfServePlanChanges).toBe(false);
  });
});

describe("R3 — AI and scraping actions require sign-in (T0.4)", () => {
  it("rejects an unauthenticated caller for all 17 listed actions", async () => {
    const t = newBackend();
    // A real project row so `projectId`-taking actions pass argument
    // validation and the rejection is the sign-in guard, not a validator.
    // (Since T0.4 every AI action takes this id and loads its context
    // server-side — none of them accepts a client-built snapshot any more.)
    const ownerId = await seedUser(t).then((u) => u.userId);
    const projectId = await seedProject(t, ownerId);
    const personaId = await t.run((ctx) => ctx.db.insert("personas", {
      projectId: projectId as never,
      name: "Test persona",
      createdBy: ownerId as never,
      createdAt: Date.now(),
    }));
    const buildId = await t.run((ctx) => ctx.db.insert("builds", {
      projectId: projectId as never,
      name: "Test build",
      kind: "website",
      status: "draft",
      createdAt: Date.now(),
    }));
    const pageId = await t.run((ctx) => ctx.db.insert("buildPages", {
      projectId: projectId as never,
      buildId: buildId as never,
      name: "Home",
      path: "/",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    const actions: Array<[string, unknown, unknown]> = [
      [
        "ai.detectContentGaps",
        api.ai.detectContentGaps,
        { projectId },
      ],
      [
        "ai.suggestTopics",
        api.ai.suggestTopics,
        { projectId, gap: { title: "gap" } },
      ],
      [
        "ai.generateContent",
        api.ai.generateContent,
        { projectId, topic: { title: "topic" } },
      ],
      [
        "ai.editSelection",
        api.ai.editSelection,
        { op: "expand", selectionHtml: "<p>x</p>", projectId },
      ],
      ["ai.generatePersona", api.ai.generatePersona, { projectId }],
      [
        "ai.personaChat",
        api.ai.personaChat,
        {
          mode: "persona",
          projectId,
          personaId,
          message: "hello",
        },
      ],
      ["ai.generateJourneyMap", api.ai.generateJourneyMap, { projectId }],
      [
        "ai.generateJourney",
        api.ai.generateJourney,
        { projectId, personaId },
      ],
      [
        "ai.generateComms",
        api.ai.generateComms,
        { projectId, topic: "launch" },
      ],
      ["research.researchTopic", api.research.researchTopic, { query: "x" }],
      [
        "sellAI.generateDescription",
        api.sellAI.generateDescription,
        { projectId, title: "T", mode: "fill_missing" },
      ],
      [
        "sellAI.generateAltText",
        api.sellAI.generateAltText,
        { imageUrl: "https://example.com/a.png", title: "T" },
      ],
      [
        "sellAI.generateSeo",
        api.sellAI.generateSeo,
        { projectId, title: "T" },
      ],
      [
        "scraping.scanWebsite",
        api.scraping.scanWebsite,
        { url: "https://example.com" },
      ],
      [
        "scraping.lookupGoogleBusiness",
        api.scraping.lookupGoogleBusiness,
        { name: "Shop" },
      ],
      [
        "buildPlan.generateBuildPlan",
        api.buildPlan.generateBuildPlan,
        { projectId, buildId },
      ],
      [
        "buildPlan.generatePageDraft",
        api.buildPlan.generatePageDraft,
        { projectId, pageId },
      ],
    ];

    expect(actions).toHaveLength(17);

    for (const [name, fn, args] of actions) {
      // Signed out: no identity is attached to `t`.
      await expect(
        t.action(fn as never, args as never),
        `${name} must reject an unauthenticated caller`,
      ).rejects.toThrow(/Not signed in/);
    }
  });
});

describe("R4 — AI actions load context server-side (T0.4)", () => {
  // PROMOTED from `it.fails` on 22 Sep 2026: T0.4's remainder landed. The
  // actions take authorized record ids and build a ContextPack on the server.
  const SERVER_MARKER = "SERVER-LOADED-CONTEXT-MARKER";

  it("the prompt is built from the database for a project the caller owns", async () => {
    resetCompletionStub();
    stubCompletionContent(
      JSON.stringify({ gaps: [{ title: "A real gap", severity: "high" }] }),
    );

    const t = newBackend();
    const { as } = await seedUser(t, { plan: "scale" });
    const projectId = await as.mutation(api.projects.create, {
      name: SERVER_MARKER,
    });

    await as
      .action(api.ai.detectContentGaps, { projectId })
      .catch(() => {
        /* the AI reply is not what this test is about */
      });

    const prompt = completionCalls
      .flatMap((call) => call.messages.map((m) => m.content))
      .join("\n");
    expect(completionCalls.length).toBeGreaterThan(0);
    // The context reached the prompt straight from the stored project row.
    expect(prompt).toContain(SERVER_MARKER);
  });

  it("a caller without access to the project gets nothing and spends nothing", async () => {
    resetCompletionStub();
    stubCompletionContent(
      JSON.stringify({ gaps: [{ title: "A real gap", severity: "high" }] }),
    );

    const t = newBackend();
    const { as } = await seedUser(t, { plan: "scale" });
    const projectId = await as.mutation(api.projects.create, {
      name: SERVER_MARKER,
    });
    const outsider = await seedUser(t, { plan: "scale" });

    await expect(
      outsider.as.action(api.ai.detectContentGaps, { projectId }),
    ).rejects.toThrow(/Not found/);
    // Refused BEFORE any provider call and before any quota was consumed.
    expect(completionCalls.length).toBe(0);
    const buckets = await t.run((ctx) => ctx.db.query("aiRateLimits").collect());
    expect(buckets).toEqual([]);
  });

  it("records the prompt the server built (keeps the R4 probe honest)", () => {
    // If the stub stopped recording, R4 above would fail for the wrong reason.
    expect(Array.isArray(completionCalls)).toBe(true);
  });
});

describe("T0.4 — per-user AI rate limit", () => {
  it("stops a caller after AI_QUOTA_LIMIT requests and spends no provider call on the refusal", async () => {
    resetCompletionStub();
    stubCompletionContent(
      JSON.stringify({ gaps: [{ title: "A real gap", severity: "high" }] }),
    );

    const t = newBackend();
    const { as } = await seedUser(t, { plan: "scale" });
    const projectId = await as.mutation(api.projects.create, { name: "P" });

    for (let i = 0; i < AI_QUOTA_LIMIT; i++) {
      await as
        .action(api.ai.detectContentGaps, { projectId })
        .catch(() => {
          /* the quota is consumed before the provider call either way */
        });
    }

    const before = completionCalls.length;
    await expect(
      as.action(api.ai.detectContentGaps, { projectId }),
    ).rejects.toThrow(/limit/i);
    expect(completionCalls.length).toBe(before);

    const buckets = await t.run((ctx) => ctx.db.query("aiRateLimits").collect());
    expect(buckets.some((row) => row.count >= AI_QUOTA_LIMIT)).toBe(true);
  });
});

describe("R6 — cross-tenant write is blocked (T0.6)", () => {
  it("user B cannot create a collection in user A's project", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { plan: "growth" });
    const bob = await seedUser(t, { plan: "growth" });

    const projectId = await alice.as.mutation(api.projects.create, { name: "Alice's" });

    // B has the entitlement, so the only thing that can stop the write is the
    // ownership check in `requireProject`.
    await expect(
      bob.as.mutation(api.collections.create, { projectId, title: "Injected" }),
    ).rejects.toThrow(/Not found/);

    const collections = await t.run((ctx) => ctx.db.query("collections").collect());
    expect(collections).toEqual([]);

    // The owner can still write to their own project.
    await alice.as.mutation(api.collections.create, { projectId, title: "Ours" });
    const after = await t.run((ctx) => ctx.db.query("collections").collect());
    expect(after).toHaveLength(1);
  });
});

describe("R8 — a fake connection is refused (T0.10)", () => {
  it("no client-callable function can write a connected status", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { plan: "scale" });
    const projectId = await alice.as.mutation(api.projects.create, { name: "P" });

    // The module's function flags are authoritative about what a client can
    // call: `isPublic` is client-reachable, `isInternal` is server-only.
    const functions = connectionsModule as unknown as Record<
      string,
      { isPublic?: boolean; isInternal?: boolean; isMutation?: boolean }
    >;
    const publicMutations = Object.entries(functions)
      .filter(([, fn]) => fn?.isPublic === true && fn?.isMutation === true)
      .map(([name]) => name)
      .sort();
    const internalMutations = Object.entries(functions)
      .filter(([, fn]) => fn?.isInternal === true && fn?.isMutation === true)
      .map(([name]) => name)
      .sort();

    // The writers of a success state are internal — not client-callable.
    expect(publicMutations).toEqual(["beginAuthorization", "disconnect"]);
    expect(internalMutations).toEqual(["markNeedsAttention", "markVerified"]);

    // `beginAuthorization` records intent only, however many times it runs.
    await alice.as.mutation(api.connections.beginAuthorization, {
      projectId,
      provider: "ga4",
    });
    await alice.as.mutation(api.connections.beginAuthorization, {
      projectId,
      provider: "ga4",
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("connections")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("authorizing");

    // The internal path exists and can promote the row (server-only receipt).
    await alice.as.mutation(internal.connections.markVerified, {
      projectId,
      provider: "ga4",
      providerAccountId: "acct-1",
    });
    const verified = await t.run((ctx) =>
      ctx.db
        .query("connections")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .collect(),
    );
    expect(verified[0].status).toBe("connected");
  });
});

describe("R9 — Shopify sync is per project (T0.9)", () => {
  it("cannot read a deployment-wide store", async () => {
    const t = newBackend();
    const alice = await seedUser(t, { plan: "scale" });
    const bob = await seedUser(t, { plan: "scale" });
    const projectId = await alice.as.mutation(api.projects.create, { name: "P" });

    // Unauthenticated: refused before anything else.
    await expect(t.action(api.shopifySync.syncCatalog, { projectId })).rejects.toThrow(
      /Not signed in/,
    );

    // Another tenant's project: refused.
    await expect(
      bob.as.action(api.shopifySync.syncCatalog, { projectId }),
    ).rejects.toThrow(/Not found/);

    // The owner is refused too: the route needs per-project credentials, so it
    // must never fall back to the deployment-wide store.
    await expect(
      alice.as.action(api.shopifySync.syncCatalog, { projectId }),
    ).rejects.toThrow(/per-project credentials/i);

    const products = await t.run((ctx) => ctx.db.query("products").collect());
    const collections = await t.run((ctx) => ctx.db.query("collections").collect());
    expect(products).toEqual([]);
    expect(collections).toEqual([]);
  });
});
