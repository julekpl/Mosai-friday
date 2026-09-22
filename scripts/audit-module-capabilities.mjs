#!/usr/bin/env bun
/**
 * Module capability audit (MOSAI pack T2.3).
 *
 * `audit-public-functions.mjs` answers "does this public function authorize its
 * record?". This one answers the next question: "is this **module** function
 * reachable without a capability check?" — the hole T2.3 closes, because a
 * `free` plan could call `builds.create` or `cms.publishPage` straight from the
 * client even though the UI hid the module.
 *
 * The rules, all driven by `src/convex/lib/capabilities.ts` (the registry is
 * the only place that knows which module owns which convex file):
 *
 *  1. every convex file is classified (`module | base | service | internal`),
 *     so a new file cannot quietly escape the gate;
 *  2. a file classified `internal` must export no public function;
 *  3. every public function in a **module** file must be declared with a
 *     module-scoped builder (`moduleQuery` / `moduleMutation` / `moduleAction`)
 *     that names that module;
 *  4. the declaration must actually enforce: the function has a `v.id(...)`
 *     argument (the builder resolves the tenant from it and checks the
 *     capability **before** the handler runs) or the body authorizes through
 *     the capability-aware access object;
 *  5. the same holds in a `"use node"` file — `moduleAction` works there too,
 *     and its probe-based enforcement needs the record argument. An action
 *     that names no record must enforce through `requireActionCapability`
 *     (the action-safe probe) instead;
 *  6. anything else must be a **documented exemption** in the registry with a
 *     non-empty reason, or on the T0.6 public allow-list (the three anonymous
 *     endpoints). No allow-list or exemption entry is added by this gate.
 *
 * Run:  bun scripts/audit-module-capabilities.mjs [--json]
 * Exit: 0 when every module function is gated, 1 otherwise.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPABILITY_EXEMPTIONS,
  CONVEX_FILE_OWNERS,
} from "../src/convex/lib/capabilities.ts";

const ROOT = process.cwd();
const CONVEX_DIR = join(ROOT, "src", "convex");
const ALLOWLIST_PATH = join(ROOT, "scripts", "public-functions-allowlist.json");
const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));

const PUBLIC_KINDS = [
  "query",
  "mutation",
  "action",
  "httpAction",
  "orgQuery",
  "orgMutation",
  "orgAction",
  "moduleQuery",
  "moduleMutation",
  "moduleAction",
];

/** Builders that carry a module capability. */
const MODULE_BUILDERS = ["moduleQuery", "moduleMutation", "moduleAction"];

/** Capability-carrying authorization inside a handler body. */
const ACCESS_GUARD =
  /\baccess\s*\.\s*(requireCapability|capabilityState|requireProject|ownedProject|ownedRow|requireOrganization)\b/;

/** The action-safe probe used by `"use node"` files. */
const ACTION_GUARD = /\brequireActionCapability\s*\(/;

const RECORD_ARG = /\bv\s*\.\s*id\s*\(/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "_generated" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function publicFunctions(source) {
  const decl =
    /^export const (\w+) = (query|mutation|action|httpAction|orgQuery|orgMutation|orgAction|moduleQuery|moduleMutation|moduleAction|internalQuery|internalMutation|internalAction)\s*\(/gm;
  const found = [];
  const hits = [...source.matchAll(decl)];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!PUBLIC_KINDS.includes(hit[2])) continue;
    const start = hit.index;
    const end = i + 1 < hits.length ? hits[i + 1].index : source.length;
    found.push({
      name: hit[1],
      kind: hit[2],
      body: source.slice(start, end),
      line: source.slice(0, start).split("\n").length,
    });
  }
  return found;
}

/** The module id a module-scoped declaration names, or null. */
function declaredModule(body, kind) {
  if (!MODULE_BUILDERS.includes(kind)) return null;
  const match = body.match(/^export const \w+ = \w+\(\s*"([a-z_]+)"\s*,/m);
  return match ? match[1] : "<unparsed>";
}

const allowlist = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
  : {};
const exempted = new Map(
  CAPABILITY_EXEMPTIONS.map((entry) => [entry.function, entry.reason]),
);

const violations = [];
const exemptionsWithProblems = [];
const unclassified = [];
const internalLeaks = [];
const perModule = {};
let total = 0;
let gated = 0;
let exempt = 0;
let allowListed = 0;
const seenExemptions = new Set();

for (const file of walk(CONVEX_DIR)) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const key = rel.replace(/^src\/convex\//, "").replace(/\.ts$/, "");
  const source = readFileSync(file, "utf8");
  const owner = CONVEX_FILE_OWNERS[key];

  const functions = publicFunctions(source);
  if (!owner) {
    unclassified.push({ file: rel, functions: functions.length });
    continue;
  }
  if (owner === "internal" && functions.length) {
    internalLeaks.push({
      file: rel,
      functions: functions.map((f) => f.name),
    });
  }
  if (owner !== "internal" && owner !== "base" && owner !== "service") {
    perModule[owner] = perModule[owner] ?? { files: 0, public: 0, gated: 0 };
    perModule[owner].files += 1;
  }

  const isNodeFile = /^\s*["']use node["'];/.test(source);

  for (const fn of functions) {
    total += 1;
    const fullKey = `${rel}::${fn.name}`;
    if (owner === "base" || owner === "service" || owner === "internal") {
      continue;
    }
    perModule[owner].public += 1;

    if (allowlist[fullKey]) {
      allowListed += 1;
      continue;
    }
    if (exempted.has(fullKey)) {
      seenExemptions.add(fullKey);
      const reason = exempted.get(fullKey);
      if (!reason || !reason.trim()) {
        exemptionsWithProblems.push({
          key: fullKey,
          problem: "exemption has no reason (a documented exemption needs one)",
        });
        continue;
      }
      exempt += 1;
      continue;
    }

    const declared = declaredModule(fn.body, fn.kind);
    if (declared === null) {
      violations.push({
        key: fullKey,
        line: fn.line,
        problem: `${owner} module: declared with \`${fn.kind}\` — use moduleQuery/moduleMutation/moduleAction("${owner}", …) or add a documented exemption`,
      });
      continue;
    }
    if (declared !== owner) {
      violations.push({
        key: fullKey,
        line: fn.line,
        problem: `declares module "${declared}" but the file is owned by "${owner}"`,
      });
      continue;
    }
    // The declaration must be real enforcement, not decoration.
    const hasRecordArg = RECORD_ARG.test(fn.body);
    if (isNodeFile) {
      if (!hasRecordArg && !ACTION_GUARD.test(fn.body)) {
        violations.push({
          key: fullKey,
          line: fn.line,
          problem:
            'a "use node" action names no record and does not enforce — take a v.id(...) argument or call requireActionCapability(…), or add a documented exemption',
        });
        continue;
      }
    } else if (!hasRecordArg && !ACCESS_GUARD.test(fn.body)) {
      violations.push({
        key: fullKey,
        line: fn.line,
        problem:
          "declares a module but neither names a record (v.id(...), which the builder enforces) nor authorizes through the capability-aware access object",
      });
      continue;
    }
    gated += 1;
    perModule[owner].gated += 1;
  }
}

/**
 * Stale-exemption check. Only meaningful when the scanned tree is the real
 * `src/convex` (the fixture-trees used by `tests/unit/audit-gate.test.ts` scan a
 * single throwaway file, so every exemption would look stale there).
 */
const scanningProjectTree = existsSync(
  join(CONVEX_DIR, "lib", "capabilities.ts"),
);
if (scanningProjectTree) {
  for (const entry of CAPABILITY_EXEMPTIONS) {
    if (!seenExemptions.has(entry.function)) {
      exemptionsWithProblems.push({
        key: entry.function,
        problem: "stale exemption: no such public function in a module file",
      });
    }
  }
}

const report = {
  registryFile: relative(
    ROOT,
    join(SCRIPT_DIR, "..", "src", "convex", "lib", "capabilities.ts"),
  ),
  scanningProjectTree,
  totalPublicFunctions: total,
  moduleFunctions: Object.values(perModule).reduce((sum, m) => sum + m.public, 0),
  capabilityGated: gated,
  documentedExemptions: exempt,
  allowListedPublicEndpoints: allowListed,
  perModule,
  exemptions: CAPABILITY_EXEMPTIONS.length,
  violations,
  exemptionsWithProblems,
  unclassifiedFiles: unclassified,
  internalFileLeaks: internalLeaks,
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`module functions scanned: ${report.moduleFunctions}`);
  console.log(`  ${gated} enforce a capability (module builder + record/access)`);
  console.log(`  ${exempt} documented exemption(s) in the registry`);
  console.log(`  ${allowListed} on the T0.6 public allow-list (anonymous endpoints)`);
  console.log(
    `  modules: ${Object.entries(perModule)
      .map(([m, v]) => `${m} ${v.gated}/${v.public}`)
      .join(" · ")}`,
  );
  if (unclassified.length) {
    console.log(`\n✗ unclassified convex file(s) — FAIL (${unclassified.length}); add them to CONVEX_FILE_OWNERS:`);
    for (const f of unclassified) console.log(`  ${f.file}`);
  }
  if (internalLeaks.length) {
    console.log(`\n✗ a library/internal file exports a public function — FAIL (${internalLeaks.length}):`);
    for (const f of internalLeaks)
      console.log(`  ${f.file}: ${f.functions.join(", ")}`);
  }
  if (exemptionsWithProblems.length) {
    console.log(`\n✗ exemption problem(s) — FAIL (${exemptionsWithProblems.length}):`);
    for (const e of exemptionsWithProblems) console.log(`  ${e.key}: ${e.problem}`);
  }
  if (violations.length) {
    console.log(`\n✗ module function reachable without a capability — FAIL (${violations.length}):`);
    for (const v of violations) console.log(`  ${v.key}:${v.line}  ${v.problem}`);
  }
  if (
    !violations.length &&
    !unclassified.length &&
    !internalLeaks.length &&
    !exemptionsWithProblems.length
  ) {
    console.log(
      `\n✓ every module function enforces a capability (or is a documented exemption)`,
    );
  }
}

process.exit(
  violations.length ||
    unclassified.length ||
    internalLeaks.length ||
    exemptionsWithProblems.length
    ? 1
    : 0,
);
