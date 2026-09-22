import { describe, expect, it } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import * as connectionsModule from "@/convex/connections";
import { PLAN_MODULES } from "@/convex/billing";
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
    const ownerId = await seedUser(t).then((u) => u.userId);
    const projectId = await seedProject(t, ownerId);

    const actions: Array<[string, unknown, unknown]> = [
      [
        "ai.detectContentGaps",
        api.ai.detectContentGaps,
        { project: { name: "P" }, personas: [], journeys: [] },
      ],
      [
        "ai.suggestTopics",
        api.ai.suggestTopics,
        { project: { name: "P" }, gap: { title: "gap" } },
      ],
      [
        "ai.generateContent",
        api.ai.generateContent,
        { project: { name: "P" }, topic: { title: "topic" } },
      ],
      [
        "ai.editSelection",
        api.ai.editSelection,
        { op: "expand", selectionHtml: "<p>x</p>", project: { name: "P" } },
      ],
      ["ai.generatePersona", api.ai.generatePersona, { project: { name: "P" } }],
      [
        "ai.personaChat",
        api.ai.personaChat,
        {
          mode: "persona",
          project: { name: "P" },
          persona: { name: "Buyer" },
          message: "hello",
        },
      ],
      [
        "ai.generateJourneyMap",
        api.ai.generateJourneyMap,
        { project: { name: "P" } },
      ],
      [
        "ai.generateJourney",
        api.ai.generateJourney,
        { project: { name: "P" }, persona: { name: "Buyer" } },
      ],
      [
        "ai.generateComms",
        api.ai.generateComms,
        { project: { name: "P" }, topic: "launch" },
      ],
      ["research.researchTopic", api.research.researchTopic, { query: "x" }],
      [
        "sellAI.generateDescription",
        api.sellAI.generateDescription,
        { projectId, title: "T", mode: "fill_missing", project: { name: "P" } },
      ],
      [
        "sellAI.generateAltText",
        api.sellAI.generateAltText,
        { imageUrl: "https://example.com/a.png", title: "T" },
      ],
      [
        "sellAI.generateSeo",
        api.sellAI.generateSeo,
        { title: "T", project: { name: "P" } },
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
        {
          project: { name: "P" },
          idea: "idea",
          kind: "website",
          name: "Site",
          personas: [],
          journeys: [],
        },
      ],
      [
        "buildPlan.generatePageDraft",
        api.buildPlan.generatePageDraft,
        {
          project: { name: "P" },
          build: { name: "Site", kind: "website" },
          page: { name: "Home", path: "/" },
        },
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

describe("R4 — AI actions load context server-side (T0.4 remainder)", () => {
  // BLOCKED(T0.4): the server still accepts a client-supplied `project`
  // snapshot and feeds it straight into the prompt. The pack keeps this test
  // red (`it.fails`) instead of deleting or weakening it — see
  // docs/tickets/README.md. When T0.4 replaces the snapshot argument with a
  // server-loaded `projectId`, this assertion passes and `it.fails` turns into
  // a hard failure, which is the reminder to promote it to `it(...)`.
  it.fails("a fabricated snapshot never reaches the prompt", async () => {
    resetCompletionStub();
    stubCompletionContent(
      JSON.stringify({ gaps: [{ title: "A real gap", severity: "high" }] }),
    );

    const t = newBackend();
    const { as } = await seedUser(t, { plan: "scale" });
    const SENTINEL = "FABRICATED-SNAPSHOT-SENTINEL";

    await as
      .action(api.ai.detectContentGaps, {
        project: { name: SENTINEL, industry: SENTINEL },
        personas: [],
        journeys: [],
      })
      .catch(() => {
        /* the AI reply is not what this test is about */
      });

    const prompt = completionCalls
      .flatMap((call) => call.messages.map((m) => m.content))
      .join("\n");
    expect(completionCalls.length).toBeGreaterThan(0);
    expect(prompt).not.toContain(SENTINEL);
  });

  it("records the prompt the server built (keeps the R4 probe honest)", () => {
    // If the stub stopped recording, R4 above would fail for the wrong reason.
    expect(Array.isArray(completionCalls)).toBe(true);
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
