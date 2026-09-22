#!/usr/bin/env node
/**
 * Public-function authorization audit (MOSAI pack T0.6 / G2).
 *
 * Lists every *public* Convex function (query / mutation / action / httpAction)
 * whose body never references an ownership guard. `assertModule` is NOT in the
 * list on purpose: it checks the caller's plan, not that the caller owns the
 * row — a function that only asserts a module still lets user B write into
 * user A's project (that was the `collections.create` bug).
 *
 * This is a text heuristic, exactly as the review describes: it can flag a
 * function that authorizes indirectly (and `metadata` bodies are skipped) and
 * it cannot see a guard invoked from a helper two calls away. It is meant to
 * make the *absence* of a guard visible in CI, not to prove correctness.
 * Generated cross-tenant tests (ADR-2 / T2.2) are the real proof.
 *
 * Usage:  node scripts/audit-public-functions.mjs [--json]
 * Exit:   0 when every public function is guarded or allow-listed, 1 otherwise.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const CONVEX_DIR = join(ROOT, "src", "convex");
const ALLOWLIST_PATH = join(ROOT, "scripts", "public-functions-allowlist.json");

/** Guards that establish tenancy through one reviewed helper. `require*`
 *  covers the canonical helpers (requireUser / requireProject /
 *  requireActionUser) and module-local ones (requireOwnedProject). The
 *  org-scoped access object (T2.2) exposes `requireProject` / `requireOrganization`
 *  and `ownedProject` / `ownedRow`, which match the same patterns. */
const STRONG_GUARDS = /\b(require[A-Z]\w*|owned[A-Z]\w*|userCtx|projectCtx)\b|\bctx\.auth\b/;
/** Hand-rolled ownership check: comparing the row's ownerId to the caller.
 *  Since T2.2 this is a **failure**, not a warning: a function that reads the
 *  owner off a project and compares it inline bypasses the organization
 *  membership rule and is exactly the pattern that produced the
 *  `collections.create` cross-tenant write. */
const INLINE_OWNERSHIP = /\.ownerId\s*(?:!==|===|!=|==)\s*\w+/;
/** The org-scoped access object (T2.2). `access.require*` / `access.owned*`
 *  authorize a specific record and already match STRONG_GUARDS; the identity
 *  fields (`access.userId`, `access.organizationIds`) only establish who the
 *  caller is, so they count as a guard for a function that has **no record id
 *  argument** (a read path that returns an empty result for a signed-out
 *  caller) and never for one that does. */
const ORG_ACCESS = /\baccess\s*\.\s*(userId|organizationIds|require\w+|owned\w+)\b/;
/** A `v.id(...)` argument means the function names a specific record, which it
 *  must therefore authorize (audit heuristic — see the file header). */
const RECORD_ARG = /\bv\s*\.\s*id\s*\(/;
/** Helpers that authenticate but leave authorization to the caller. */
const WEAK_GUARDS = /\b(getAuthUserId|maybeUser)\b/;

/** Every wrapper that produces a public Convex function, including the T2.2
 *  org-scoped builders. */
const PUBLIC_KINDS = [
  "query",
  "mutation",
  "action",
  "httpAction",
  "orgQuery",
  "orgMutation",
  "orgAction",
];

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

/** Split a module into top-level `export const <name> = <kind>(` declarations.
 *  Internal declarations are boundaries too: a public function's body must not
 *  swallow a neighbouring `internalQuery`'s `v.id(...)` arguments, or a
 *  self-scoped read would look like it names a record. */
function publicFunctions(source) {
  const decl =
    /^export const (\w+) = (query|mutation|action|httpAction|orgQuery|orgMutation|orgAction|internalQuery|internalMutation|internalAction)\s*\(/gm;
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

const allowlist = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
  : {};

const findings = [];
const weak = [];
const inline = [];
/** Authenticates, names a specific record, and never authorizes it. */
const unscoped = [];
let guarded = 0;
let total = 0;

for (const file of walk(CONVEX_DIR)) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const source = readFileSync(file, "utf8");
  for (const fn of publicFunctions(source)) {
    total++;
    const key = `${rel}::${fn.name}`;
    if (allowlist[key]) continue;
    if (STRONG_GUARDS.test(fn.body)) {
      guarded++;
      continue;
    }
    if (ORG_ACCESS.test(fn.body) && !RECORD_ARG.test(fn.body)) {
      guarded++;
      continue;
    }
    // An inline `project.ownerId !== userId` check bypasses organization
    // membership and is the pattern that produced the collections.create bug.
    // T2.2 migrated all 81 of them; from now on this is a hard failure.
    if (INLINE_OWNERSHIP.test(fn.body)) {
      inline.push({ key, file: rel, line: fn.line, name: fn.name, kind: fn.kind });
      continue;
    }
    if (WEAK_GUARDS.test(fn.body)) {
      const entry = { key, file: rel, line: fn.line, name: fn.name, kind: fn.kind };
      // A function that names a record (`v.id(...)`) but only authenticates is
      // unscoped: it will happily read or write another tenant's row. That is
      // a failure, not a review note. A function with no record argument is
      // self-scoped (``currentUser``, ``generateUploadUrl``, admin settings),
      // so it stays a warning for a human to read.
      if (RECORD_ARG.test(fn.body)) unscoped.push(entry);
      else weak.push(entry);
      continue;
    }
    findings.push({ key, file: rel, line: fn.line, name: fn.name, kind: fn.kind });
  }
}

if (process.argv.includes("--json")) {
  console.log(
    JSON.stringify(
      {
        total,
        guarded,
        inlineOwnership: inline,
        authButNotAuthorized: weak,
        unscopedRecords: unscoped,
        unguarded: findings,
      },
      null,
      2,
    ),
  );
} else {
  console.log(`public functions scanned: ${total}`);
  console.log(`  ${guarded} authorize through a shared guard / org access helper`);
  if (inline.length) {
    console.log(
      `\n✗ inline ownerId authorization — FAIL (${inline.length}); use orgQuery/orgMutation/orgAction and access.requireProject/ownedRow:`,
    );
    for (const f of inline) console.log(`  ${f.file}:${f.line}  ${f.kind} ${f.name}`);
  }
  if (weak.length) {
    console.log(`\n! authenticates but never authorizes — REVIEW (${weak.length}):`);
    for (const f of weak) console.log(`  ${f.file}:${f.line}  ${f.kind} ${f.name}`);
  }
  if (unscoped.length) {
    console.log(
      `\n✗ authenticates but never authorizes a named record — FAIL (${unscoped.length}); authorize the record with access.requireProject/ownedRow or requireProject/ownedRow:`,
    );
    for (const f of unscoped) console.log(`  ${f.file}:${f.line}  ${f.kind} ${f.name}`);
  }
  if (findings.length) {
    console.log(`\n✗ no sign-in check at all — FAIL (${findings.length}):`);
    for (const f of findings) console.log(`  ${f.file}:${f.line}  ${f.kind} ${f.name}`);
  }
  if (!findings.length && !inline.length && !unscoped.length) {
    console.log(`\n✓ every public function authenticates and authorizes (or is allow-listed)`);
  }
}

process.exit(findings.length || inline.length || unscoped.length ? 1 : 0);
