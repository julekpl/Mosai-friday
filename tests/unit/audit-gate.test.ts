// @vitest-environment node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * T2.2 — the CI gate really fails on an unscoped public function.
 *
 * `bun run audit:functions` runs `scripts/audit-public-functions.mjs` inside
 * `bun run check` and in CI. This test runs that exact script against
 * throwaway convex modules so the gate is proven to fire, not just observed to
 * pass on today's tree:
 *
 *  - a public function with no sign-in check at all → exit 1;
 *  - a public function that only authenticates but names a record → exit 1;
 *  - the pre-T2.2 inline `project.ownerId !== userId` check → exit 1;
 *  - an `orgQuery` read path that authorizes through the org access object and
 *    names no record → exit 0.
 *
 * Nothing here touches the real `src/convex`; each fixture is written to its
 * own temp directory, the same pattern the secret-scan test uses.
 */

const ROOT = process.cwd();
const AUDIT = join(ROOT, "scripts", "audit-public-functions.mjs");

const dirs: string[] = [];

function withModule(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mosai-audit-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src", "convex"), { recursive: true });
  writeFileSync(join(dir, "src", "convex", "fixture.ts"), source);
  return dir;
}

function runAudit(dir: string) {
  return spawnSync(process.execPath, [AUDIT], { cwd: dir, encoding: "utf8" });
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
