// @vitest-environment node
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * R11 — the secret scan fails on a planted dummy secret (MOSAI pack T1.7 / T0.1).
 *
 * `bun run check` and the CI `security` job both run `scripts/scan-secrets.mjs`,
 * which reads the project's rules from `.gitleaks.toml`. This test runs that
 * exact script in a throwaway directory (a copy of the rules plus a planted
 * file) so the gate is proven to actually fire, without ever touching the real
 * working tree.
 *
 * The planted value is assembled at runtime on purpose: a literal in this file
 * would itself trip the scanner.
 */

const ROOT = process.cwd();
const SCANNER = join(ROOT, "scripts", "scan-secrets.mjs");

const dirs: string[] = [];

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mosai-secret-scan-"));
  dirs.push(dir);
  copyFileSync(join(ROOT, ".gitleaks.toml"), join(dir, ".gitleaks.toml"));
  return dir;
}

function runScanner(dir: string) {
  return spawnSync(process.execPath, [SCANNER], { cwd: dir, encoding: "utf8" });
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("R11 — secret scan", () => {
  it("fails on a planted dummy OTP key", () => {
    const dir = makeDir();
    const planted = ["x-api-key", ":", "A".repeat(40)].join(" ");
    writeFileSync(join(dir, "leak.ts"), `const cfg = "${planted}";\n`);

    const result = runScanner(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout + result.stderr).toContain("vly-email-otp-key");
    // The scanner must never echo the value it matched.
    expect(result.stdout + result.stderr).not.toContain("A".repeat(40));
  });

  it("passes on a clean tree", () => {
    const dir = makeDir();
    writeFileSync(join(dir, "clean.ts"), "export const greeting = 'hello';\n");

    const result = runScanner(dir);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("No secrets found");
  });

  it("refuses a no-op scan when the rules file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "mosai-secret-scan-"));
    dirs.push(dir);

    const result = runScanner(dir);

    expect(result.status).toBe(1);
  });
});
