// @vitest-environment node
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

/**
 * T0.1 review regression — tracked `.env*` files must be scanned.
 *
 * The old scanner skipped EVERY `.env*` path, so a committed `.env.keys`
 * holding private-key material made the local scan report clean while gitleaks
 * flagged it in CI. The scanner now skips `.env*` files only when they are
 * UNTRACKED (local secrets), and scans them when git tracks them (committed
 * credentials — the exact gap the review found).
 *
 * Each case runs the real `scripts/scan-secrets.mjs` in a throwaway git
 * repository. The planted value is assembled at runtime so this file itself
 * never trips the scanner.
 */

const ROOT = process.cwd();
const SCANNER = join(ROOT, "scripts", "scan-secrets.mjs");
const GIT_AVAILABLE =
  spawnSync("git", ["--version"], { encoding: "utf8" }).status === 0;

const dirs: string[] = [];

/** A temp git repo with the project's rules in place. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mosai-env-scan-"));
  dirs.push(dir);
  copyFileSync(join(ROOT, ".gitleaks.toml"), join(dir, ".gitleaks.toml"));
  spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  spawnSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"],
    { cwd: dir, encoding: "utf8" },
  );
  return dir;
}

function runScanner(dir: string) {
  return spawnSync(process.execPath, [SCANNER], { cwd: dir, encoding: "utf8" });
}

/** dotenvx-style private key material, assembled so this file stays clean. */
function plantedDotenvKey(): string {
  return ["DOTENV_PRIVATE_KEY", "=", "A".repeat(48)].join("");
}

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!GIT_AVAILABLE)("T0.1 — scanner covers tracked .env files", () => {
  it("fails on a TRACKED .env.keys holding private-key material", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ".env.keys"), `${plantedDotenvKey()}\n`);
    // -f: a global gitignore that hides .env* must not defeat the test.
    const add = spawnSync("git", ["add", "-f", ".env.keys"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(add.status, add.stderr).toBe(0);

    const result = runScanner(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout + result.stderr).toContain("dotenvx-private-key");
    // The scanner must never echo the value it matched.
    expect(result.stdout + result.stderr).not.toContain("A".repeat(48));
  });

  it("passes on an UNTRACKED local .env.local (local secrets stay local)", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ".env.local"), `${plantedDotenvKey()}\n`);

    const result = runScanner(dir);

    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("No secrets found");
  });

  it("still scans non-.env files so the old coverage is not lost", () => {
    const dir = makeRepo();
    const planted = ["x-api-key", ":", "B".repeat(40)].join(" ");
    writeFileSync(join(dir, "leak.ts"), `const cfg = "${planted}";\n`);
    spawnSync("git", ["add", "."], { cwd: dir, encoding: "utf8" });

    const result = runScanner(dir);

    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout + result.stderr).toContain("vly-email-otp-key");
  });
});
