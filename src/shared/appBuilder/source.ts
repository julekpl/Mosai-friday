/**
 * App builder source protocol (BP-15), shared by the Convex generator and the
 * browser preview.
 *
 * The model answers in the `<file path="…">…</file>` format used by
 * open-lovable (MIT, firecrawl/open-lovable; see THIRD_PARTY_NOTICES.md).
 * Everything here is pure: it parses, bounds and validates model output and
 * never executes it. Generated code only ever runs in the preview iframe on
 * the bundler's own origin, never on the dashboard origin (AGENTS.md rule 9).
 */

export const APP_SOURCE_LIMITS = {
  maxFiles: 60,
  maxFileBytes: 60_000,
  maxTotalBytes: 600_000,
  maxPathLength: 120,
  maxDependencies: 30,
  maxPromptChars: 4_000,
} as const;

export type AppFile = { path: string; content: string };
export type AppDependency = { name: string; version: string };

/** Files the template owns. The model may not rewrite them. */
export const TEMPLATE_OWNED_PATHS: ReadonlySet<string> = new Set([
  "package.json",
  "vite.config.js",
  "tailwind.config.js",
  "postcss.config.js",
  "index.html",
  "public/index.html",
]);

const ALLOWED_EXTENSIONS = /\.(jsx|js|css|json|md|svg)$/;
const SAFE_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/**
 * Normalizes a model-supplied path to `src/...`, or returns null when the path
 * is unsafe (absolute, traversal, hidden, template-owned or an unknown type).
 */
export function normalizeAppPath(raw: string): string | null {
  const trimmed = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  if (!trimmed || trimmed.length > APP_SOURCE_LIMITS.maxPathLength) return null;
  const segments = trimmed.split("/");
  if (segments.some((segment) => !SAFE_SEGMENT.test(segment))) return null;
  if (TEMPLATE_OWNED_PATHS.has(trimmed)) return null;
  if (segments[0] !== "src") return null;
  if (!ALLOWED_EXTENSIONS.test(trimmed)) return null;
  return trimmed;
}

export type ParsedGeneration = {
  files: AppFile[];
  /** Paths the model opened but never closed (output was cut off). */
  truncated: string[];
  /** Paths refused by `normalizeAppPath`, reported back to the user. */
  rejected: string[];
  /** Packages the model asked for with `<package>` / `<packages>`. */
  packages: string[];
  /** Model prose outside file blocks (its short explanation). */
  explanation: string;
};

function stripFence(content: string): string {
  const body = content.replace(/^\n/, "").replace(/\n$/, "");
  const fenced = body.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```\s*$/);
  return fenced ? fenced[1] : body;
}

/** Parses a model reply. Later blocks for the same path win. */
export function parseGeneration(text: string): ParsedGeneration {
  const files = new Map<string, string>();
  const truncated: string[] = [];
  const rejected: string[] = [];
  const blockRegex = /<file path="([^"]+)">([\s\S]*?)(<\/file>|$)/g;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(text)) !== null) {
    const path = normalizeAppPath(match[1]);
    if (!path) {
      rejected.push(match[1].slice(0, APP_SOURCE_LIMITS.maxPathLength));
      continue;
    }
    if (!match[3]) {
      truncated.push(path);
      continue;
    }
    files.set(path, stripFence(match[2]));
  }
  const packages = new Set<string>();
  for (const found of text.matchAll(/<package>([^<]+)<\/package>/g)) packages.add(found[1].trim());
  for (const found of text.matchAll(/<packages>([\s\S]*?)<\/packages>/g)) {
    for (const name of found[1].split(/[\n,]/)) if (name.trim()) packages.add(name.trim());
  }
  const explanation = text
    .replace(/<file path="[^"]+">[\s\S]*?(<\/file>|$)/g, "")
    .replace(/<packages?>[\s\S]*?<\/packages?>/g, "")
    .replace(/<\/?(explanation|thinking)>/g, "")
    .trim()
    .slice(0, 2_000);
  return {
    files: [...files].map(([path, content]) => ({ path, content })),
    truncated: truncated.filter((path) => !files.has(path)),
    rejected,
    packages: [...packages].filter(isValidPackageName),
    explanation,
  };
}

const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function isValidPackageName(name: string): boolean {
  return name.length <= 80 && PACKAGE_NAME.test(name);
}

/** Pinned versions for the template's own and commonly generated packages. */
export const KNOWN_VERSIONS: Readonly<Record<string, string>> = {
  react: "18.3.1",
  "react-dom": "18.3.1",
  "lucide-react": "0.460.0",
  "react-router-dom": "6.28.0",
  "framer-motion": "11.11.17",
  clsx: "2.1.1",
  "date-fns": "4.1.0",
  recharts: "2.13.3",
  zustand: "5.0.1",
};

/** Bare import specifier → package name (`@scope/pkg/sub` → `@scope/pkg`). */
export function packageOfSpecifier(specifier: string): string | null {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return isValidPackageName(name) ? name : null;
}

/** Dependencies the source imports, plus packages the model requested. */
export function detectDependencies(files: AppFile[], requested: string[] = []): AppDependency[] {
  const names = new Set<string>(["react", "react-dom"]);
  const importRegex = /(?:import\s+(?:[^'"]*?\s+from\s+)?|import\(\s*|require\(\s*)['"]([^'"]+)['"]/g;
  for (const file of files) {
    if (!/\.(jsx?|tsx?)$/.test(file.path)) continue;
    for (const found of file.content.matchAll(importRegex)) {
      const name = packageOfSpecifier(found[1]);
      if (name) names.add(name);
    }
  }
  for (const name of requested) if (isValidPackageName(name)) names.add(name);
  return [...names]
    .sort()
    .slice(0, APP_SOURCE_LIMITS.maxDependencies)
    .map((name) => ({ name, version: KNOWN_VERSIONS[name] ?? "latest" }));
}

export function sourceBytes(files: AppFile[]): number {
  return files.reduce((sum, file) => sum + new TextEncoder().encode(file.content).length, 0);
}

/**
 * Merges changed files over a base snapshot and enforces the limits. Throws a
 * user-readable error when the result would be too large.
 */
export function mergeFiles(base: AppFile[], changes: AppFile[], deletions: string[] = []): AppFile[] {
  const merged = new Map(base.map((file) => [file.path, file.content]));
  for (const path of deletions) merged.delete(path);
  for (const file of changes) {
    if (new TextEncoder().encode(file.content).length > APP_SOURCE_LIMITS.maxFileBytes) {
      throw new Error(`${file.path} is larger than ${APP_SOURCE_LIMITS.maxFileBytes / 1000} KB`);
    }
    merged.set(file.path, file.content);
  }
  const files = [...merged].map(([path, content]) => ({ path, content })).sort((a, b) => a.path.localeCompare(b.path));
  if (files.length > APP_SOURCE_LIMITS.maxFiles) throw new Error(`An app can have at most ${APP_SOURCE_LIMITS.maxFiles} files`);
  if (sourceBytes(files) > APP_SOURCE_LIMITS.maxTotalBytes) throw new Error("The app source is too large to save");
  return files;
}

/** The starting point every new app is generated over. */
export const STARTER_FILES: AppFile[] = [
  {
    path: "src/main.jsx",
    content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`,
  },
  {
    path: "src/App.jsx",
    content: `export default function App() {
  return (
    <main className="min-h-screen grid place-items-center bg-gray-50 text-gray-900">
      <p className="text-sm text-gray-500">Describe your app in the chat to generate it.</p>
    </main>
  );
}
`,
  },
  {
    path: "src/index.css",
    content: `body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
`,
  },
];

/**
 * Chooses which existing files to show the model for an edit (a port of the
 * idea behind open-lovable's context selector, without a second model call):
 * always App.jsx and main.jsx, then files whose name or content matches words
 * in the request, then the rest, within a character budget.
 */
export function selectEditContext(files: AppFile[], prompt: string, budgetChars = 40_000): AppFile[] {
  const words = new Set(
    prompt.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2),
  );
  const score = (file: AppFile) => {
    if (file.path === "src/App.jsx" || file.path === "src/main.jsx") return 1_000;
    const name = file.path.toLowerCase();
    let total = 0;
    for (const word of words) {
      if (name.includes(word)) total += 50;
      if (file.content.toLowerCase().includes(word)) total += 5;
    }
    return total;
  };
  const ranked = [...files].sort((a, b) => score(b) - score(a) || a.path.localeCompare(b.path));
  const chosen: AppFile[] = [];
  let used = 0;
  for (const file of ranked) {
    if (used + file.content.length > budgetChars) continue;
    chosen.push(file);
    used += file.content.length;
  }
  return chosen;
}
