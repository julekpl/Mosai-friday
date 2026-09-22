#!/usr/bin/env node
/**
 * Working-tree secret scan (MOSAI pack T1.5 / T0.1).
 *
 * `gitleaks` is the canonical scanner, and CI runs it over full history and the
 * working diff (see `.gitleaks.toml` and `docs/runbooks/secret-rotation.md`).
 * It is not installed in every local environment, so `bun run check` uses this
 * small, dependency-free scanner instead. It reads the same custom rules from
 * `.gitleaks.toml` — one source of truth — and applies them to the files that
 * could be committed. It does not replace gitleaks' built-in rules or its
 * history scan; it exists so a planted secret fails `bun run check` everywhere.
 *
 * Usage:  node scripts/scan-secrets.mjs
 * Exit:   0 when no rule matches, 1 when a finding is reported.
 *
 * Never paste a real value into this file, a test, a ticket or a log.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, ".gitleaks.toml");

/** Directories and files that must never be scanned: dependencies, VCS data,
 *  build output, binary assets and the gitignored environment files (their
 *  values are local-only; the file itself is what `.gitignore` protects). */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vly", "coverage"]);
const SKIP_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico",
  "woff", "woff2", "ttf", "eot", "otf", "pdf", "zip",
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Parse the `[[rules]]` blocks and the `[allowlist]` paths out of the TOML.
 *  Only the subset gitleaks uses for these project-specific rules is needed. */
function loadConfig(text) {
  const rules = [];
  const chunks = text.split("[[rules]]").slice(1);
  for (const chunk of chunks) {
    const body = chunk.split("\n[[rules]]")[0].split("\n[allowlist]")[0];
    const id = body.match(/id\s*=\s*"([^"]+)"/)?.[1];
    const regex = body.match(/regex\s*=\s*'''([\s\S]*?)'''/)?.[1];
    if (!id || !regex) continue;
    try {
      rules.push({ id, regex: new RegExp(regex, "g") });
    } catch (err) {
      console.warn(`! skipping rule "${id}": invalid regex (${err.message})`);
    }
  }

  const allowlistBlock = text.match(/\[allowlist\][\s\S]*?paths\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const skipPatterns = [...allowlistBlock.matchAll(/'''([\s\S]*?)'''/g)].map((m) => m[1]);

  return { rules, skipPatterns };
}

function shouldSkipPath(relPath, skipPatterns) {
  if (relPath === ".env.example") return false;
  if (/(^|\/)\.env(\.|$)/.test(relPath)) return true;
  return skipPatterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(relPath);
    } catch {
      return false;
    }
  });
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* walk(full);
    else if (stat.isFile()) yield full;
  }
}

function scanFile(file, rules) {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  if (SKIP_EXTENSIONS.has(ext)) return [];
  if (statSync(file).size > MAX_FILE_BYTES) return [];

  const relPath = relative(ROOT, file).split(sep).join("/");
  const content = readFileSync(file, "utf8");
  const lines = content.split("\n");
  const findings = [];

  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(content)) !== null) {
      const line = content.slice(0, match.index).split("\n").length;
      const rawLine = lines[line - 1] ?? "";
      // Never echo the credential itself — redact the matched span.
      const preview = rawLine.replace(match[0], "[redacted]").trim();
      findings.push({ rule: rule.id, path: relPath, line, preview });
      if (match.index === rule.regex.lastIndex) rule.regex.lastIndex += 1;
    }
  }
  return findings;
}

function main() {
  let raw;
  try {
    raw = readFileSync(CONFIG_PATH, "utf8");
  } catch {
    console.error("✗ Could not read .gitleaks.toml.");
    process.exit(1);
  }

  const { rules, skipPatterns } = loadConfig(raw);
  if (rules.length === 0) {
    console.error("✗ No secret-scan rules found in .gitleaks.toml — refusing a no-op scan.");
    process.exit(1);
  }

  const findings = [];
  for (const file of walk(ROOT)) {
    const relPath = relative(ROOT, file).split(sep).join("/");
    if (shouldSkipPath(relPath, skipPatterns)) continue;
    findings.push(...scanFile(file, rules));
  }

  if (findings.length > 0) {
    console.error(`\n✗ Possible secret(s) in the working tree (${findings.length}):\n`);
    for (const f of findings) {
      console.error(`  ${f.path}:${f.line}  [${f.rule}]`);
      if (f.preview) console.error(`    ${f.preview.slice(0, 120)}`);
    }
    console.error(
      "\n  Do not print the value. Rotate the credential (docs/runbooks/secret-rotation.md),\n" +
        "  remove it from the file, and only then re-run.",
    );
    process.exit(1);
  }

  console.log(`✓ No secrets found (${rules.length} rules from .gitleaks.toml).`);
}

main();
