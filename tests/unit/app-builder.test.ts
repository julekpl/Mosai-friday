import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { newBackend, seedUser } from "./helpers";

/**
 * BP-15 app builder: chat turn → job → generated snapshot. The model is a
 * scripted stub behind the OpenRouter fetch boundary; no network.
 */

type ModelRequest = { messages: { role: string; content: string }[] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function scriptModel(replies: string[]): ModelRequest[] {
  const calls: ModelRequest[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (new URL(url).hostname !== "openrouter.ai") throw new Error(`live network blocked in tests: ${url}`);
    calls.push(JSON.parse(String(init?.body ?? "{}")) as ModelRequest);
    const content = replies[Math.min(calls.length - 1, replies.length - 1)] ?? "";
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  return calls;
}

const FIRST_VERSION = `<explanation>Built a booking screen.</explanation>
<file path="src/App.jsx">
import Booking from "./components/Booking.jsx";
export default function App() { return <Booking />; }
</file>
<file path="src/components/Booking.jsx">
import { Calendar } from "lucide-react";
export default function Booking() { return <p><Calendar /> Book a roast tasting</p>; }
</file>
<file path="../../etc/passwd">nope</file>`;

async function setup() {
  const t = newBackend();
  const owner = await seedUser(t, { plan: "starter" });
  const projectId = (await owner.as.mutation(api.projects.create, { name: "Roastery" })) as Id<"projects">;
  await owner.as.mutation(api.personas.create, { projectId, name: "Coffee lover Carla" });
  const buildId = (await owner.as.mutation(api.builds.create, {
    projectId,
    name: "Booking app",
    kind: "app",
    idea: "Let customers book tastings",
  })) as Id<"builds">;
  return { t, owner, projectId, buildId };
}

describe("app builder chat turn", () => {
  it("queues a job, generates from server-loaded context and writes a version", async () => {
    const calls = scriptModel([FIRST_VERSION]);
    const { t, owner, buildId } = await setup();
    vi.useFakeTimers();
    const runId = await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, {
      buildId,
      prompt: "Build a tasting booking app",
    });
    let view = await owner.as.query(api.modules.buildApp.workspace.workspace, { buildId });
    expect(view?.runs.at(-1)).toMatchObject({ _id: runId, status: "queued", mode: "create" });
    expect(view?.head?.source).toBe("starter");

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    view = await owner.as.query(api.modules.buildApp.workspace.workspace, { buildId });
    const run = view?.runs.at(-1);
    // The traversal path was refused, so the run reports a partial result.
    expect(run).toMatchObject({ status: "partially_succeeded", snapshotVersion: 2, reply: "Built a booking screen." });
    expect(run?.changedPaths).toEqual(["src/App.jsx", "src/components/Booking.jsx"]);
    expect(run?.skippedPaths).toEqual(["../../etc/passwd"]);
    expect(view?.head?.version).toBe(2);
    expect(view?.head?.files.map((file) => file.path)).toEqual([
      "src/App.jsx",
      "src/components/Booking.jsx",
      "src/index.css",
      "src/main.jsx",
    ]);
    expect(view?.head?.dependencies.map((dependency) => dependency.name)).toEqual(["lucide-react", "react", "react-dom"]);

    // Context came from the database: the persona is in the prompt.
    const user = calls[0].messages.find((message) => message.role === "user")?.content ?? "";
    expect(user).toContain("Coffee lover Carla");
    expect(user).toContain("<request>\nBuild a tasting booking app\n</request>");
  });

  it("switches to edit mode and sends only the changed files back", async () => {
    scriptModel([
      FIRST_VERSION,
      `<explanation>Darker header.</explanation>\n<file path="src/components/Booking.jsx">export default function Booking() { return <p className="bg-gray-900">Book</p>; }</file>`,
    ]);
    const { t, owner, buildId } = await setup();
    vi.useFakeTimers();
    await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Build it" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Make booking dark" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const view = await owner.as.query(api.modules.buildApp.workspace.workspace, { buildId });
    expect(view?.runs.at(-1)).toMatchObject({ mode: "edit", status: "succeeded", snapshotVersion: 3 });
    expect(view?.head?.files.find((file) => file.path === "src/App.jsx")?.content).toContain("<Booking />");
    expect(view?.head?.files.find((file) => file.path === "src/components/Booking.jsx")?.content).toContain("bg-gray-900");
  });

  it("fails honestly when the reply has no files, and writes nothing", async () => {
    scriptModel(["Sorry, I cannot help with that."]);
    const { t, owner, buildId } = await setup();
    vi.useFakeTimers();
    await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Build it" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const view = await owner.as.query(api.modules.buildApp.workspace.workspace, { buildId });
    expect(view?.runs.at(-1)?.status).toBe("failed");
    expect(view?.head?.version).toBe(1);
  });

  it("refuses a second request while one is running, and a canceled run writes nothing", async () => {
    scriptModel([FIRST_VERSION]);
    const { t, owner, buildId } = await setup();
    const runId = await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Build it" });
    await expect(
      owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Again" }),
    ).rejects.toThrow(/still running/);
    await owner.as.mutation(api.modules.buildApp.workspace.cancelRun, { runId });
    await t.action(internal.modules.buildApp.generate.run, { runId });
    const view = await owner.as.query(api.modules.buildApp.workspace.workspace, { buildId });
    expect(view?.runs.at(-1)?.status).toBe("canceled");
    expect(view?.head?.version).toBe(1);
  });
});

describe("app builder versions", () => {
  it("saves hand edits as a version, refuses stale bases and restores forward", async () => {
    scriptModel([FIRST_VERSION]);
    const { t, owner, buildId } = await setup();
    vi.useFakeTimers();
    await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Build it" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const saved = await owner.as.mutation(api.modules.buildApp.workspace.saveFile, {
      buildId,
      baseVersion: 2,
      path: "src/App.jsx",
      content: "export default function App() { return null; }\n",
    });
    expect(saved).toBe(3);
    await expect(
      owner.as.mutation(api.modules.buildApp.workspace.saveFile, { buildId, baseVersion: 2, path: "src/App.jsx", content: "x" }),
    ).rejects.toThrow(/changed since/);
    await expect(
      owner.as.mutation(api.modules.buildApp.workspace.saveFile, { buildId, baseVersion: 3, path: "package.json", content: "{}" }),
    ).rejects.toThrow(/not allowed/);

    const restored = await owner.as.mutation(api.modules.buildApp.workspace.restoreVersion, { buildId, version: 2 });
    expect(restored).toBe(4);
    const view = await owner.as.query(api.modules.buildApp.workspace.workspace, { buildId });
    expect(view?.head?.files.find((file) => file.path === "src/App.jsx")?.content).toContain("<Booking />");
    expect(view?.versions.map((version) => version.source)).toEqual(["restore", "manual", "ai", "starter"]);
    // Identical file bodies are stored once per build.
    const bodies = await t.run((ctx) => ctx.db.query("appSourceFiles").collect());
    expect(new Set(bodies.map((row) => row.hash)).size).toBe(bodies.length);
  });

  it("keeps another tenant out and removes app rows with the build", async () => {
    scriptModel([FIRST_VERSION]);
    const { t, owner, buildId } = await setup();
    const stranger = await seedUser(t, { plan: "starter" });
    await expect(
      stranger.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Steal" }),
    ).rejects.toThrow();
    expect(await stranger.as.query(api.modules.buildApp.workspace.workspace, { buildId })).toBeNull();

    vi.useFakeTimers();
    await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Build it" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await owner.as.mutation(api.builds.remove, { id: buildId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const counts = await t.run(async (ctx) => ({
      runs: (await ctx.db.query("appRuns").collect()).length,
      snapshots: (await ctx.db.query("appSnapshots").collect()).length,
      files: (await ctx.db.query("appSourceFiles").collect()).length,
    }));
    expect(counts).toEqual({ runs: 0, snapshots: 0, files: 0 });
  });
});

describe("app builder abandoned jobs", () => {
  it("does not let a job that never started block the chat forever", async () => {
    scriptModel([FIRST_VERSION]);
    const { t, owner, buildId } = await setup();
    const stuck = await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Build it" });
    await t.run((ctx) => ctx.db.patch(stuck, { createdAt: Date.now() - 11 * 60_000 }));
    let view = await owner.as.query(api.modules.buildApp.workspace.workspace, { buildId });
    expect(view?.runs.at(-1)).toMatchObject({ status: "failed", error: "The generation stopped responding." });
    await owner.as.mutation(api.modules.buildApp.workspace.sendMessage, { buildId, prompt: "Try again" });
    const row = await t.run((ctx) => ctx.db.get(stuck));
    expect(row?.status).toBe("failed");
    view = await owner.as.query(api.modules.buildApp.workspace.workspace, { buildId });
    expect(view?.runs.at(-1)).toMatchObject({ prompt: "Try again", status: "queued" });
  });
});
