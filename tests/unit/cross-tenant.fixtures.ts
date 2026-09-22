/**
 * Fixtures for the generated cross-tenant suite (MOSAI pack T2.2).
 *
 * Seeds tenant A with a real project, user and organization, then lazily
 * materializes one real row per table an argument references, so a foreign
 * caller is handed **tenant A's real ids** — not fabricated ones. That is what
 * makes the suite a proof of isolation rather than a smoke test.
 *
 * If a table cannot be seeded from its own schema, the fixture falls back to a
 * syntactically valid id and records the table in `unseeded`, so the suite can
 * assert that every project-scoped table was seeded for real.
 */

import type { Id } from "@/convex/_generated/dataModel";
import schema from "@/convex/schema";
import type { Tenant, TestBackend } from "./helpers";

/** A structurally valid Convex id that belongs to no row. */
export const FABRICATED_ID = "0".repeat(31) + "1";

type SchemaShape = {
  tables: Record<
    string,
    { validator?: { fields?: Record<string, ValidatorLike> } }
  >;
};

type ValidatorLike = {
  kind?: string;
  isOptional?: string;
  tableName?: string;
  value?: unknown;
  element?: ValidatorLike;
  members?: ValidatorLike[];
  fields?: Record<string, ValidatorLike>;
};

const TABLES = Object.keys((schema as unknown as SchemaShape).tables);

type CounterCtx = {
  db: { query(table: string): { collect(): Promise<unknown[]> } };
};
type InsertCtx = {
  db: { insert(table: string, doc: Record<string, unknown>): Promise<string> };
  storage: { store(blob: Blob): Promise<string> };
};

export async function snapshotCounts(
  t: TestBackend,
): Promise<Record<string, number>> {
  return await t.run(async (ctx) => {
    const db = (ctx as unknown as CounterCtx).db;
    const out: Record<string, number> = {};
    for (const table of TABLES) {
      out[table] = (await db.query(table).collect()).length;
    }
    return out;
  });
}

export type TenantContext = {
  ids: Record<string, string>;
  ensure(table: string): Promise<string>;
  /** Tables whose fixture fell back to a fabricated id. */
  unseeded: Set<string>;
};

function requiredFields(fields: Record<string, ValidatorLike>) {
  return Object.entries(fields).filter(
    ([, f]) => f.isOptional !== "optional",
  );
}

/** Build a value for a **runtime schema validator** (fixture seeding). */
async function sampleFromSchema(
  field: ValidatorLike,
  ensure: (table: string) => Promise<string>,
  depth: number,
): Promise<unknown> {
  if (depth > 6) return null;
  switch (field.kind) {
    case "id":
      return await ensure(field.tableName ?? "");
    case "string":
      return "cross-tenant";
    case "float64":
    case "int64":
    case "number":
      return 1;
    case "boolean":
      return true;
    case "literal":
      return field.value;
    case "union":
      return field.members?.length
        ? await sampleFromSchema(field.members[0], ensure, depth + 1)
        : null;
    case "array":
      return [];
    case "object": {
      const doc: Record<string, unknown> = {};
      for (const [k, f] of requiredFields(field.fields ?? {})) {
        doc[k] = await sampleFromSchema(f, ensure, depth + 1);
      }
      return doc;
    }
    case "bytes":
      return new ArrayBuffer(1);
    default:
      return null;
  }
}

/** Build a value for the JSON form of an **argument validator** (arg sample). */
async function sampleFromArgJson(
  node: { type?: string; value?: unknown; tableName?: string } | null,
  ensure: (table: string) => Promise<string>,
  depth: number,
): Promise<unknown> {
  if (!node || depth > 6) return null;
  switch (node.type) {
    case "id":
      return await ensure(node.tableName ?? "");
    case "string":
      return "cross-tenant";
    case "number":
    case "float64":
    case "int64":
      return 1;
    case "boolean":
      return true;
    case "literal":
      return node.value;
    case "union": {
      const members = Array.isArray(node.value) ? node.value : [];
      return members.length
        ? await sampleFromArgJson(
            members[0] as { type?: string },
            ensure,
            depth + 1,
          )
        : null;
    }
    case "array":
      return [];
    case "object": {
      const fields = (node.value ?? {}) as Record<
        string,
        { fieldType?: { type?: string }; optional?: boolean }
      >;
      const out: Record<string, unknown> = {};
      for (const [k, f] of Object.entries(fields)) {
        if (f.optional) continue;
        out[k] = await sampleFromArgJson(
          (f.fieldType ?? null) as { type?: string } | null,
          ensure,
          depth + 1,
        );
      }
      return out;
    }
    case "bytes":
      return new ArrayBuffer(1);
    default:
      return null;
  }
}

/**
 * Tenant A: a real owner, project and organization, plus a lazy row factory for
 * every other table an argument references.
 */
export async function tenantContext(
  t: TestBackend,
  owner: Tenant,
  projectId: string,
): Promise<TenantContext> {
  const ids: Record<string, string> = {
    users: owner.userId,
    projects: projectId,
  };
  const seeding = new Set<string>();
  const unseeded = new Set<string>();

  const org = await t.run((ctx) =>
    ctx.db
      .query("organizations")
      .withIndex("by_personal_for", (q) =>
        q.eq("personalFor", owner.userId as Id<"users">),
      )
      .first(),
  );
  if (org) ids.organizations = org._id;

  async function ensure(table: string): Promise<string> {
    const existing = ids[table];
    if (existing) return existing;
    if (table === "_storage") {
      const id = await t.run((ctx) =>
        (ctx as unknown as InsertCtx).storage.store(
          new Blob([new Uint8Array([7])]),
        ),
      );
      ids[table] = id;
      return id;
    }
    const tableDef = (schema as unknown as SchemaShape).tables[table];
    if (!tableDef?.validator?.fields) {
      unseeded.add(table);
      return FABRICATED_ID;
    }
    if (seeding.has(table)) return FABRICATED_ID;
    seeding.add(table);
    try {
      const doc: Record<string, unknown> = {};
      for (const [k, f] of requiredFields(tableDef.validator.fields)) {
        doc[k] = await sampleFromSchema(f, ensure, 0);
      }
      const id = await t.run((ctx) =>
        (ctx as unknown as InsertCtx).db.insert(table, doc),
      );
      ids[table] = id;
      return id;
    } catch {
      unseeded.add(table);
      return FABRICATED_ID;
    } finally {
      seeding.delete(table);
    }
  }

  return { ids, ensure, unseeded };
}

/** Build a call's arguments from its exported schema, using tenant A's rows. */
export async function buildArgs(
  argSchema: unknown,
  ensure: (table: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  const root = argSchema as { type?: string; value?: unknown } | null;
  if (!root || root.type !== "object" || !root.value) return {};
  const fields = root.value as Record<
    string,
    { fieldType?: { type?: string }; optional?: boolean }
  >;
  const args: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    if (field.optional) continue;
    args[name] = await sampleFromArgJson(
      (field.fieldType ?? null) as { type?: string } | null,
      ensure,
      0,
    );
  }
  return args;
}

/** True when a returned value reveals nothing about another tenant. */
export function revealsNothing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

/** Tables that carry a `projectId` field — the tenancy-relevant tables. */
export function projectScopedTables(): string[] {
  const tables = (schema as unknown as SchemaShape).tables;
  return Object.entries(tables)
    .filter(([, def]) => {
      const fields = def.validator?.fields ?? {};
      return Object.prototype.hasOwnProperty.call(fields, "projectId");
    })
    .map(([name]) => name)
    .sort();
}
