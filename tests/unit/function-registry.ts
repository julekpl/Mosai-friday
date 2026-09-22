/**
 * Function registry (MOSAI pack T2.2).
 *
 * Enumerates every **public** Convex function in `src/convex/**` by loading the
 * modules exactly the way the test backend does, and reading each function's
 * exported argument schema (`exportArgs()`). The generated cross-tenant suite
 * (`cross-tenant.generated.test.ts`) is driven off this registry: one test case
 * per public function, produced at run time, so a new public function is
 * exercised the moment it is added — there is no list to keep in sync.
 *
 * The generator is the registry itself: `buildFunctionRegistry()` is the
 * "test generator over the function registry" the ticket asks for. It is
 * deliberately independent of any hand-written allow-list; the only
 * classification is structural (does the function take a record id?).
 */

import { makeFunctionReference } from "convex/server";

export type FunctionKind = "query" | "mutation" | "action";

export type RegistryEntry = {
  /** `module:function`, e.g. `ads/control:createDraft`. */
  name: string;
  /** Module path inside `src/convex`, e.g. `ads/control`. */
  module: string;
  exported: string;
  kind: FunctionKind;
  /** Parsed `exportArgs()` JSON (null for the empty-arg case). */
  argSchema: unknown;
  /** Tables referenced by any `v.id(...)` argument (recursively). */
  argTables: string[];
  /** A function with an id argument has a record it must authorize. */
  tenantScoped: boolean;
};

const modules = import.meta.glob("../../src/convex/**/*.ts", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

type ValidatorJson = {
  type?: string;
  value?: unknown;
  tableName?: string;
};

/** Collect every table named by a `v.id(...)` anywhere in an argument schema. */
function collectIdTables(node: unknown): string[] {
  if (!node || typeof node !== "object") return [];
  const v = node as ValidatorJson;
  switch (v.type) {
    case "id":
      return v.tableName ? [v.tableName] : [];
    case "array":
    case "union":
      return Array.isArray(v.value)
        ? v.value.flatMap(collectIdTables)
        : collectIdTables(v.value);
    case "object":
      return collectObjectTables(v.value);
    default:
      return [];
  }
}

function collectObjectTables(fields: unknown): string[] {
  if (!fields || typeof fields !== "object") return [];
  return Object.values(fields as Record<string, unknown>).flatMap((field) => {
    const f = field as { fieldType?: unknown };
    return collectIdTables(f.fieldType);
  });
}

function kindOf(fn: {
  isQuery?: boolean;
  isMutation?: boolean;
  isAction?: boolean;
}): FunctionKind | null {
  if (fn.isQuery) return "query";
  if (fn.isMutation) return "mutation";
  if (fn.isAction) return "action";
  return null;
}

export function buildFunctionRegistry(): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const [file, mod] of Object.entries(modules)) {
    const modulePath = file
      .replace(/^.*\/src\/convex\//, "")
      .replace(/\.ts$/, "");
    if (modulePath.startsWith("_generated/")) continue;
    if (modulePath === "test.setup") continue;
    for (const [exported, value] of Object.entries(mod)) {
      const fn = value as {
        isPublic?: boolean;
        isQuery?: boolean;
        isMutation?: boolean;
        isAction?: boolean;
        exportArgs?: () => string;
      };
      if (!fn || fn.isPublic !== true) continue;
      const kind = kindOf(fn);
      if (!kind) continue;
      let argSchema: unknown = null;
      if (typeof fn.exportArgs === "function") {
        const raw = fn.exportArgs();
        argSchema = raw ? JSON.parse(raw) : null;
      }
      const argTables = [...new Set(collectIdTables(argSchema))].sort();
      entries.push({
        name: `${modulePath}:${exported}`,
        module: modulePath,
        exported,
        kind,
        argSchema,
        argTables,
        tenantScoped: argTables.length > 0,
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

/** A typed reference for a registry name, for `convex-test` calls. */
export function referenceFor(entry: RegistryEntry) {
  return makeFunctionReference(entry.name);
}
