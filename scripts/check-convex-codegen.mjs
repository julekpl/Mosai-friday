#!/usr/bin/env node
/**
 * Convex codegen drift check (MOSAI pack T1.2 / G-P1).
 *
 * `src/convex/_generated` is committed (see `.gitignore`), so a fresh clone
 * typechecks without running Convex first. This check makes sure the committed
 * bindings still match the `convex/` sources: it regenerates them with the
 * official CLI and then fails if anything in the tracked folder changed.
 *
 * `convex codegen` is the Convex-documented tool for exactly this ("Regenerating
 * it explicitly is rarely needed (e.g. in CI to ensure the correct code was
 * checked in)"). It is preferred over `convex dev --once` because it does not
 * push running code to the deployment.
 *
 * CI needs a reachable deployment to regenerate against (`CONVEX_DEPLOYMENT` +
 * `CONVEX_DEPLOY_KEY`); a fresh-clone *typecheck* does not, because the bindings
 * are committed. T1.5 wires this into the `check` script / CI `codegen` job.
 *
 * Usage:  node scripts/check-convex-codegen.mjs
 * Exit:   0 when the committed bindings are current, 1 otherwise.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const GENERATED_DIR = join("src", "convex", "_generated");

function fail(message) {
  console.error(`\n✗ Convex codegen drift check failed.\n${message}\n`);
  console.error(
    "  If you changed convex/ on purpose, run `bun run codegen` and commit the\n" +
      "  result. Never hand-edit src/convex/_generated/* to fix a type error —\n" +
      "  that is a bug in the source, not in the generated output.",
  );
  process.exit(1);
}

const isWindows = process.platform === "win32";
const convexBin = join(
  ROOT,
  "node_modules",
  ".bin",
  isWindows ? "convex.cmd" : "convex",
);

if (!existsSync(convexBin)) {
  fail(`Convex CLI not found at ${convexBin}. Run \`bun install\` first.`);
}

// 1. Regenerate the bindings from the current convex/ sources.
const codegen = spawnSync(convexBin, ["codegen"], {
  cwd: ROOT,
  stdio: "inherit",
  shell: isWindows,
});
if (codegen.status !== 0) {
  fail(`\`convex codegen\` exited ${codegen.status ?? "without a status"}.`);
}

// 2. Fail if regeneration changed the committed folder. `git diff` covers
//    edits and deletions of tracked files; a brand-new binding file would be
//    untracked and is caught by `tsc` instead (the import would not resolve).
const diff = spawnSync(
  "git",
  ["diff", "--exit-code", "--", GENERATED_DIR],
  { cwd: ROOT, encoding: "utf8" },
);
if (diff.error) {
  fail(`Could not run git: ${diff.error.message}`);
}
if (diff.stdout?.trim()) {
  process.stderr.write(diff.stdout);
}
if (diff.stderr?.trim()) {
  process.stderr.write(diff.stderr);
}
if (diff.status !== 0) {
  fail("The committed Convex bindings do not match a fresh `convex codegen`.");
}

console.log(`✓ Convex codegen is in sync (${GENERATED_DIR}).`);
