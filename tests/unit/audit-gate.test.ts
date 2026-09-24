// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * T2.2 / T2.3 — the CI gates really fail on an unscoped or ungated function.
 *
 * `bun run audit:functions` and `bun run audit:capabilities` run inside
 * `bun run check` and in CI. These tests run those exact scripts against
 * throwaway convex modules so the gates are proven to fire, not just observed
 * to pass on today's tree:
 *
 *  T2.2 — authorization:
 *   - a public function with no sign-in check at all → exit 1;
 *   - a public function that only authenticates but names a record → exit 1;
 *   - the pre-T2.2 inline `project.ownerId !== userId` check → exit 1;
 *   - an `orgQuery` read that authorizes through the org access object → exit 0.
 *
 *  T2.3 — module capabilities:
 *   - a module function declared with a plain `query` → exit 1;
 *   - a module function that names no record and never checks the capability →
 *     exit 1;
 *   - a convex file the registry does not classify → exit 1;
 *   - a library file that exports a public function → exit 1;
 *   - a module function gated by its builder and a record argument → exit 0.
 *
 * Nothing here touches the real `src/convex`; each fixture is written to its
 * own temp directory, the same pattern the secret-scan test uses.
 */

const ROOT = process.cwd();
const AUDIT = join(ROOT, "scripts", "audit-public-functions.mjs");
const CAPABILITY_AUDIT = join(
  ROOT,
  "scripts",
  "audit-module-capabilities.mjs",
);
/** The capability gate imports the registry (`src/convex/lib/capabilities.ts`),
 *  so it must run under bun, not plain node. */
const BUN = process.env.BUN_BIN ?? "bun";

const dirs: string[] = [];

function withModule(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mosai-audit-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src", "convex"), { recursive: true });
  writeFileSync(join(dir, "src", "convex", "fixture.ts"), source);
  return dir;
}

/** A throwaway tree with the named convex files. */
function withCapabilityTree(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "mosai-capability-"));
  dirs.push(dir);
  for (const [name, source] of Object.entries(files)) {
    const full = join(dir, "src", "convex", name);
    mkdirSync(join(dir, "src", "convex"), { recursive: true });
    writeFileSync(full, source);
  }
  return dir;
}

function runAudit(dir: string) {
  return spawnSync(process.execPath, [AUDIT], { cwd: dir, encoding: "utf8" });
}

function runCapabilityAudit(dir: string) {
  return spawnSync(BUN, [CAPABILITY_AUDIT], { cwd: dir, encoding: "utf8" });
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const IMPORTS = `import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { orgQuery } from "./guards";
`;

describe("T2.2 — public-function authorization gate", () => {
  it("passes on the real tree", () => {
    const result = spawnSync(process.execPath, [AUDIT], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("authorize through a shared guard");
  });

  it("fails a public function that only authenticates", () => {
    const dir = withModule(
      `${IMPORTS}
export const bad = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    return await ctx.db.get(id);
  },
});
`,
    );

    const result = runAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("bad");
    expect(result.stdout).toContain("never authorizes a named record");
  });

  it("fails a public function that calls getAuthUserId and discards the result", () => {
    // The files.generateUploadUrl defect: no record argument, so it used to be
    // a REVIEW warning (exit 0) even though a signed-out caller got through.
    const dir = withModule(
      `${IMPORTS}
export const mint = query({
  args: {},
  handler: async (ctx) => {
    await getAuthUserId(ctx);
    return "upload-url";
  },
});
`,
    );

    const result = runAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("mint");
    expect(result.stdout).toContain("no sign-in check at all");
  });

  it("fails a public function with no sign-in check at all", () => {
    const dir = withModule(
      `${IMPORTS}
export const open = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => await ctx.db.get(id),
});
`,
    );

    const result = runAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("no sign-in check at all");
  });

  it("fails an inline ownerId authorization check", () => {
    const dir = withModule(
      `${IMPORTS}
export const legacy = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const project = await ctx.db.get(id);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    return project;
  },
});
`,
    );

    const result = runAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("inline ownerId authorization");
  });

  it("passes an org-scoped read that authorizes through the access object", () => {
    const dir = withModule(
      `${IMPORTS}
export const list = orgQuery({
  args: {},
  handler: async (ctx, _args, access) => {
    if (!access.userId) return [];
    return await ctx.db
      .query("projects")
      .withIndex("by_organization", (q) =>
        q.eq("organizationId", access.organizationIds[0]),
      )
      .collect();
  },
});
`,
    );

    const result = runAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
});

describe("T2.3 — module capability gate", () => {
  it("passes on the real tree", () => {
    const result = runCapabilityAudit(ROOT);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      "every module function enforces a capability",
    );
  });

  it("fails a module function declared with a plain query", () => {
    const dir = withCapabilityTree({
      "builds.ts": `import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireProject } from "./guards";

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId);
    return [];
  },
});
`,
    });

    const result = runCapabilityAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("src/convex/builds.ts::list");
    expect(result.stdout).toContain("moduleQuery");
  });

  it("fails a module function that names no record and never checks the capability", () => {
    const dir = withCapabilityTree({
      "builds.ts": `import { v } from "convex/values";
import { moduleMutation } from "./guards";

export const rebuild = moduleMutation("build", {
  args: { note: v.string() },
  handler: async (_ctx, { note }, access) => {
    await access.requireUser();
    return note;
  },
});
`,
    });

    const result = runCapabilityAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("neither names a record");
  });

  it("fails an unclassified convex file, so a new file cannot escape the gate", () => {
    const dir = withCapabilityTree({
      "someNewModule.ts": "export const nothing = 1;\n",
    });

    const result = runCapabilityAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("unclassified convex file");
  });

  it("fails a library file that exports a public function", () => {
    const dir = withCapabilityTree({
      "buildInternals.ts": `import { v } from "convex/values";
import { moduleQuery } from "./guards";

export const leak = moduleQuery("build", {
  args: { projectId: v.id("projects") },
  handler: async (_ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    return scope ? [] : [];
  },
});
`,
    });

    const result = runCapabilityAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("exports a public function");
  });

  it("passes a module function gated by its builder and a record argument", () => {
    const dir = withCapabilityTree({
      "builds.ts": `import { v } from "convex/values";
import { moduleMutation } from "./guards";

export const create = moduleMutation("build", {
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (_ctx, { projectId, name }, access) => {
    await access.requireProject(projectId);
    return name;
  },
});
`,
    });

    const result = runCapabilityAudit(dir);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("1 enforce a capability");
  });
});
