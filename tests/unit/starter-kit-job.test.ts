import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { emptyStarterKitPart, type StarterKitPart } from "@/shared/starterKit";
import {
  STARTER_KIT_BUDGET_MICROUSD,
  STARTER_KIT_UNKNOWN_CALL_MICROUSD,
  isAllowedStarterLink,
  mainButtonsFor,
  parseStarterKitPlan,
  parseStarterKitPosts,
  reduceStarterKitStatus,
  resetPartsForRetry,
  starterLinkErrors,
  type StarterKitParts,
} from "@/shared/starterKitJob";
import { buildFunctionRegistry } from "./function-registry";
import { newBackend, seedUser, type TestBackend, type Tenant } from "./helpers";

/**
 * U3 — starter kit job. The model is a scripted stub behind the OpenRouter
 * fetch boundary, routed by which kit agent is asking (plan, site, posts), so
 * each part can be made to fail alone. No network.
 */

type Agent = "plan" | "site" | "posts";
type Reply = { content: string } | { error: true };

const PLAN = JSON.stringify({
  customers: [{ text: "Neighbours who want good coffee", basis: "assumption" }],
  thisWeek: [
    { action: "Post opening hours", why: "People ask", basis: "assumption" },
    { action: "Ask three regulars for a review", why: "Trust", basis: "assumption" },
    { action: "Put a sign outside", why: "Walk-ins", basis: "assumption" },
  ],
});
const SITE = JSON.stringify({
  pages: [
    {
      name: "Home",
      path: "/",
      sections: [
        { type: "hero", props: { heading: "Fresh roasts", body: "Coffee.", ctaLabel: "Call", ctaHref: "tel:+441234567" } },
        { type: "cta", props: { heading: "Visit us", buttonLabel: "Find us", buttonHref: "https://www.google.com/maps" } },
      ],
    },
  ],
});
const POSTS = JSON.stringify({
  posts: Array.from({ length: 7 }, (_, index) => ({
    channel: ["facebook", "instagram", "linkedin", "x"][index % 4],
    body: `Post number ${index + 1} from the roastery.`,
  })),
});

const OK: Record<Agent, Reply> = {
  plan: { content: PLAN },
  site: { content: SITE },
  posts: { content: POSTS },
};

function agentOf(system: string): Agent {
  if (system.includes("one-week marketing plan")) return "plan";
  if (system.includes("site generator")) return "site";
  if (system.includes("social media posts")) return "posts";
  throw new Error(`unexpected model call: ${system.slice(0, 80)}`);
}

/** Script the model per agent; returns the agents called, in order. */
function scriptKitModel(replies: Record<Agent, Reply>): Agent[] {
  const calls: Agent[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (new URL(url).hostname !== "openrouter.ai") throw new Error(`live network blocked: ${url}`);
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { role: string; content: string }[] };
    const agent = agentOf(body.messages[0]?.content ?? "");
    calls.push(agent);
    const reply = replies[agent];
    if ("error" in reply) {
      return new Response(JSON.stringify({ error: "provider exploded: secret-detail" }), { status: 500 });
    }
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply.content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  return calls;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function setup(plan = "starter") {
  const t = newBackend();
  const tenant = await seedUser(t, { plan, email: "owner@example.com" });
  const projectId = (await tenant.as.mutation(api.projects.create, { name: "Roastery" })) as Id<"projects">;
  return { t, tenant, projectId };
}

async function startAndRun(t: TestBackend, tenant: Tenant, projectId: Id<"projects">) {
  vi.useFakeTimers();
  const kitId = await tenant.as.mutation(api.starterKit.start, { projectId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return kitId;
}

async function kitOf(t: TestBackend, kitId: Id<"starterKits">): Promise<Doc<"starterKits">> {
  const kit = await t.run((ctx) => ctx.db.get(kitId));
  if (!kit) throw new Error("kit missing");
  return kit;
}

async function rows(t: TestBackend, projectId: Id<"projects">) {
  return await t.run(async (ctx) => ({
    posts: await ctx.db.query("posts").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
    pieces: await ctx.db.query("contentPieces").withIndex("by_project", (q) => q.eq("projectId", projectId)).collect(),
    builds: (await ctx.db.query("builds").collect()).filter((row) => row.projectId === projectId),
    deployments: await ctx.db.query("buildDeployments").collect(),
    scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
  }));
}

/* ── Pure rules ─────────────────────────────────────────────────────────── */

function part(status: StarterKitPart["status"], errorCode?: string): StarterKitPart {
  return { ...emptyStarterKitPart(1), status, errorCode };
}

function parts(plan: StarterKitPart, site: StarterKitPart, posts: StarterKitPart): StarterKitParts {
  return { plan, site, posts };
}

describe("starter kit status reduction", () => {
  it("reduces parts to the kit's standard job state", () => {
    const ok = part("succeeded");
    const partial = part("partially_succeeded");
    const failed = part("failed", "ai_error");
    const needsPlan = part("queued", "needs_plan");
    expect(reduceStarterKitStatus(parts(ok, ok, ok))).toBe("succeeded");
    expect(reduceStarterKitStatus(parts(ok, ok, partial))).toBe("partially_succeeded");
    expect(reduceStarterKitStatus(parts(ok, needsPlan, needsPlan))).toBe("waiting_for_user");
    expect(reduceStarterKitStatus(parts(failed, needsPlan, needsPlan))).toBe("waiting_for_user");
    expect(reduceStarterKitStatus(parts(failed, failed, failed))).toBe("failed");
    expect(reduceStarterKitStatus(parts(failed, ok, partial))).toBe("partially_succeeded");
    expect(reduceStarterKitStatus(parts(ok, part("running"), ok))).toBe("running");
    expect(reduceStarterKitStatus(parts(ok, part("queued"), ok))).toBe("running");
  });

  it("a retry resets only failed and needs-plan parts, keeping finished outputs", () => {
    const kept: StarterKitPart = { ...part("succeeded"), outputs: [{ type: "contentPieces", id: "p1" }], message: "done" };
    const reset = resetPartsForRetry(
      parts(kept, { ...part("failed", "ai_error"), message: "x", attempts: 1 }, { ...part("queued", "needs_plan"), message: "Needs the Starter plan" }),
      99,
    );
    expect(reset.plan).toBe(kept);
    expect(reset.site).toEqual({ status: "queued", outputs: [], attempts: 1, updatedAt: 99 });
    expect(reset.posts).toEqual({ status: "queued", outputs: [], attempts: 0, updatedAt: 99 });
  });

  it("validates model outputs and the site link policy", () => {
    expect(parseStarterKitPlan(PLAN).thisWeek).toHaveLength(3);
    expect(() => parseStarterKitPlan(JSON.stringify({ customers: [], thisWeek: [] }))).toThrow();
    expect(parseStarterKitPosts(POSTS)).toHaveLength(7);
    expect(() => parseStarterKitPosts(JSON.stringify({ posts: [{ channel: "tiktok", body: "x" }] }))).toThrow();
    for (const ok of ["tel:+44123", "mailto:a@b.co", "https://x.example", "/about", ""]) expect(isAllowedStarterLink(ok)).toBe(true);
    for (const bad of ["javascript:alert(1)", "http://x.example", "//evil.example", "/\\evil.example", "data:text/html,x"]) expect(isAllowedStarterLink(bad)).toBe(false);
    expect(starterLinkErrors({ type: "richText", props: { html: '<a href="http://x">x</a>' } })).toHaveLength(1);
    expect(mainButtonsFor("walk_in", { address: "1 High St", phone: "+44 1234 567" })).toEqual([
      { label: "Find us", href: "https://www.google.com/maps/search/?api=1&query=1%20High%20St" },
      { label: "Call", href: "tel:+441234567" },
    ]);
    expect(mainButtonsFor("shop", { phone: "not a phone", email: "shop@example.com" })).toEqual([
      { label: "Email", href: "mailto:shop@example.com" },
    ]);
    expect(STARTER_KIT_BUDGET_MICROUSD).toBe(400_000);
  });
});

/* ── The job ────────────────────────────────────────────────────────────── */

describe("starterKit job", () => {
  it("drafts a plan, a website and 7 posts, and never publishes, schedules or deploys", async () => {
    const { t, tenant, projectId } = await setup();
    const calls = scriptKitModel(OK);
    const kitId = await startAndRun(t, tenant, projectId);

    const kit = await kitOf(t, kitId);
    expect(calls).toEqual(["plan", "site", "posts"]);
    expect(kit.parts.plan).toMatchObject({ status: "succeeded", attempts: 1 });
    expect(kit.parts.site).toMatchObject({ status: "succeeded", message: "Your website draft is ready" });
    expect(kit.parts.posts).toMatchObject({
      status: "partially_succeeded",
      message: "0 of 7 posts have pictures; add your own for the rest.",
    });
    expect(kit.status).toBe("partially_succeeded");
    expect(kit.finishedAt).toBeDefined();
    expect(kit.spentMicrousd).toBe(3 * STARTER_KIT_UNKNOWN_CALL_MICROUSD);

    const data = await rows(t, projectId);
    expect(data.pieces).toHaveLength(1);
    expect(data.pieces[0]).toMatchObject({ contentType: "marketing_plan", status: "draft", title: "Your plan for this week" });
    expect(JSON.parse(data.pieces[0]!.body!)).toEqual(JSON.parse(PLAN));
    expect(data.posts).toHaveLength(7);
    for (const post of data.posts) {
      expect(post.status).toBe("draft");
      expect(post.origin).toBe("copilot");
      expect(post.scheduledFor).toBeUndefined();
      expect(post.mediaUrl).toBeUndefined();
    }
    expect(data.builds).toHaveLength(1);
    expect(data.builds[0]!.status).not.toBe("published");
    expect(data.deployments).toEqual([]);
    const sites = await t.run((ctx) => ctx.db.query("sites").collect());
    expect(sites.every((site) => site.status !== "published")).toBe(true);
    expect(kit.parts.site.outputs.map((o) => o.type)).toEqual(["builds", "sites"]);
    expect(kit.parts.posts.outputs).toHaveLength(7);

    const runs = await t.run((ctx) => ctx.db.query("aiRuns").collect());
    expect(runs.map((run) => run.agentId).sort()).toEqual(["starter_kit.plan", "starter_kit.posts", "starter_kit.site"]);
    expect(runs.every((run) => run.autonomy === "draft" && run.promptVersion === "v1")).toBe(true);
  });

  for (const failing of ["plan", "site", "posts"] as const) {
    it(`a ${failing} failure stops only that part`, async () => {
      const { t, tenant, projectId } = await setup();
      scriptKitModel({ ...OK, [failing]: { error: true } });
      const kitId = await startAndRun(t, tenant, projectId);
      const kit = await kitOf(t, kitId);
      expect(kit.parts[failing]).toMatchObject({ status: "failed", errorCode: "ai_error" });
      expect(kit.parts[failing].message).not.toMatch(/exploded|secret|provider/i);
      for (const other of (["plan", "site", "posts"] as const).filter((name) => name !== failing)) {
        expect(["succeeded", "partially_succeeded"]).toContain(kit.parts[other].status);
      }
      expect(kit.status).toBe("partially_succeeded");
    });
  }

  it("fails the kit when every part fails", async () => {
    const { t, tenant, projectId } = await setup();
    scriptKitModel({ plan: { error: true }, site: { error: true }, posts: { error: true } });
    const kitId = await startAndRun(t, tenant, projectId);
    expect((await kitOf(t, kitId)).status).toBe("failed");
  });

  it("retry resumes only the failed part and leaves finished outputs untouched", async () => {
    const { t, tenant, projectId } = await setup();
    scriptKitModel({ ...OK, plan: { error: true } });
    const kitId = await startAndRun(t, tenant, projectId);
    const before = await kitOf(t, kitId);
    const rowsBefore = await rows(t, projectId);

    const calls = scriptKitModel(OK);
    const again = await tenant.as.mutation(api.starterKit.start, { projectId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(again).toBe(kitId);
    expect(calls).toEqual(["plan"]);
    const after = await kitOf(t, kitId);
    expect(after.attempts).toBe(2);
    expect(after.parts.plan).toMatchObject({ status: "succeeded", attempts: 2 });
    expect(after.parts.site).toEqual(before.parts.site);
    expect(after.parts.posts).toEqual(before.parts.posts);
    const rowsAfter = await rows(t, projectId);
    expect(rowsAfter.posts).toEqual(rowsBefore.posts);
    expect(rowsAfter.builds).toEqual(rowsBefore.builds);
    expect(rowsAfter.pieces).toHaveLength(1);
    expect(after.status).toBe("partially_succeeded");
  });

  it("resumes a kit whose run died (stale queued/running) but leaves a live run alone", async () => {
    const { t, tenant, projectId } = await setup();
    scriptKitModel(OK);
    vi.useFakeTimers();
    const kitId = await tenant.as.mutation(api.starterKit.start, { projectId });
    // Simulate a run that died mid-part: the kit is left "running" with the
    // plan part claimed, and nothing scheduled.
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        await ctx.scheduler.cancel(job._id);
      }
      const kit = await ctx.db.get(kitId);
      if (!kit) throw new Error("kit missing");
      await ctx.db.patch(kitId, {
        status: "running",
        parts: { ...kit.parts, plan: { ...kit.parts.plan, status: "running", attempts: 1 } },
        updatedAt: Date.now(),
      });
    });

    // Still fresh: a second start must not start a competing run.
    expect(await tenant.as.mutation(api.starterKit.start, { projectId })).toBe(kitId);
    expect((await kitOf(t, kitId)).attempts).toBe(1);

    // Older than any action can live: start resumes it.
    await t.run((ctx) => ctx.db.patch(kitId, { updatedAt: Date.now() - 16 * 60_000 }));
    const calls = scriptKitModel(OK);
    expect(await tenant.as.mutation(api.starterKit.start, { projectId })).toBe(kitId);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await kitOf(t, kitId);
    expect(after.attempts).toBe(2);
    expect(calls).toEqual(["plan", "site", "posts"]);
    expect(after.parts.plan.status).toBe("succeeded");
    expect(after.status).toBe("partially_succeeded");
  });

  it("a duplicate start returns the same kit and schedules nothing", async () => {
    const { t, tenant, projectId } = await setup();
    scriptKitModel(OK);
    vi.useFakeTimers();
    const first = await tenant.as.mutation(api.starterKit.start, { projectId });
    const second = await tenant.as.mutation(api.starterKit.start, { projectId });
    expect(second).toBe(first);
    expect((await rows(t, projectId)).scheduled).toHaveLength(1);
    const kits = await t.run((ctx) => ctx.db.query("starterKits").collect());
    expect(kits).toHaveLength(1);
    expect(kits[0]).toMatchObject({ status: "queued", attempts: 1, idempotencyKey: projectId, budgetCurrency: "USD" });

    // Finished kits are returned as they are, too.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const scheduledBefore = (await rows(t, projectId)).scheduled.length;
    await t.run((ctx) => ctx.db.patch(first, { status: "succeeded" }));
    expect(await tenant.as.mutation(api.starterKit.start, { projectId })).toBe(first);
    expect((await rows(t, projectId)).scheduled).toHaveLength(scheduledBefore);
  });

  it("a duplicate run does not call the model or write again", async () => {
    const { t, tenant, projectId } = await setup();
    scriptKitModel(OK);
    const kitId = await startAndRun(t, tenant, projectId);
    const before = await rows(t, projectId);
    const calls = scriptKitModel(OK);
    await t.action(internal.starterKit.run, { kitId });
    expect(calls).toEqual([]);
    const after = await rows(t, projectId);
    expect(after.posts).toHaveLength(before.posts.length);
    expect(after.pieces).toHaveLength(before.pieces.length);
    expect(after.builds).toHaveLength(before.builds.length);
  });

  it("the budget cap stops further AI calls with ai_budget", async () => {
    const { t, tenant, projectId } = await setup();
    const calls = scriptKitModel(OK);
    vi.useFakeTimers();
    const kitId = await tenant.as.mutation(api.starterKit.start, { projectId });
    await t.run((ctx) => ctx.db.patch(kitId, { budgetMicrousd: STARTER_KIT_UNKNOWN_CALL_MICROUSD }));
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const kit = await kitOf(t, kitId);
    expect(calls).toEqual(["plan"]);
    expect(kit.parts.plan.status).toBe("succeeded");
    expect(kit.parts.site).toMatchObject({ status: "failed", errorCode: "ai_budget" });
    expect(kit.parts.posts).toMatchObject({ status: "failed", errorCode: "ai_budget" });
    expect(kit.status).toBe("partially_succeeded");
  });

  it("a free plan drafts the plan and waits for the Starter plan for the rest", async () => {
    const { t, tenant, projectId } = await setup("free");
    const calls = scriptKitModel(OK);
    const kitId = await startAndRun(t, tenant, projectId);
    const kit = await kitOf(t, kitId);
    expect(calls).toEqual(["plan"]);
    expect(kit.parts.plan.status).toBe("succeeded");
    for (const name of ["site", "posts"] as const) {
      expect(kit.parts[name]).toMatchObject({ status: "queued", errorCode: "needs_plan", message: "Needs the Starter plan" });
    }
    expect(kit.status).toBe("waiting_for_user");
    expect((await rows(t, projectId)).builds).toEqual([]);
  });

  it("does not regenerate a website that already has pages", async () => {
    const { t, tenant, projectId } = await setup();
    const buildId = (await tenant.as.mutation(api.builds.create, { projectId, name: "Website", kind: "website" })) as Id<"builds">;
    scriptKitModel({ ...OK, posts: { error: true } });
    vi.useFakeTimers();
    await tenant.as.action(api.buildChat.generateSite, { buildId, message: "Site" });
    const pagesBefore = await t.run((ctx) => ctx.db.query("cmsPages").collect());
    const calls = scriptKitModel(OK);
    const kitId = await tenant.as.mutation(api.starterKit.start, { projectId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const kit = await kitOf(t, kitId);
    expect(calls).toEqual(["plan", "posts"]);
    expect(kit.parts.site).toMatchObject({ status: "succeeded", message: "Your website draft is ready" });
    expect(kit.parts.site.outputs[0]).toEqual({ type: "builds", id: buildId });
    expect(await t.run((ctx) => ctx.db.query("cmsPages").collect())).toEqual(pagesBefore);
  });

  it("get and dismiss are scoped to the caller's organization", async () => {
    const { t, tenant, projectId } = await setup();
    scriptKitModel(OK);
    const kitId = await startAndRun(t, tenant, projectId);
    const bob = await seedUser(t, { plan: "scale", email: "bob@example.com" });
    await bob.as.mutation(api.projects.create, { name: "Bob project" });

    expect(await bob.as.query(api.starterKit.get, { projectId })).toBeNull();
    await expect(bob.as.mutation(api.starterKit.start, { projectId })).rejects.toThrow(/Not found/);
    await expect(bob.as.mutation(api.starterKit.dismiss, { projectId })).rejects.toThrow(/Not found/);
    expect((await kitOf(t, kitId)).dismissedAt).toBeUndefined();

    expect((await tenant.as.query(api.starterKit.get, { projectId }))?._id).toBe(kitId);
    await tenant.as.mutation(api.starterKit.dismiss, { projectId });
    expect((await kitOf(t, kitId)).dismissedAt).toBeDefined();
  });

  it("the generated cross-tenant suite covers starterKit start, get and dismiss", () => {
    const entries = buildFunctionRegistry().filter((entry) => entry.module === "starterKit");
    expect(entries.map((entry) => `${entry.exported}:${entry.tenantScoped}`).sort()).toEqual([
      "content:true",
      "dismiss:true",
      "get:true",
      "start:true",
    ]);
  });
});
