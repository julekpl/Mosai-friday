import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";
import {
  isValidCustomerEmail,
  normalizeCustomerEmail,
} from "../lib/customerCsv";

export const list = moduleQuery("customers", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("contacts")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("customers", {
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args, access) => {
    await access.requireProject(args.projectId);
    const { projectId, email, ...rest } = args;
    const normalizedEmail = email
      ? normalizeCustomerEmail(email) || undefined
      : undefined;
    if (
      email !== undefined &&
      (!normalizedEmail || !isValidCustomerEmail(normalizedEmail))
    ) {
      throw new Error("Enter a valid email address.");
    }
    if (normalizedEmail) {
      // New writes use the canonical email index and are idempotent. Existing
      // mixed-case legacy rows require a future indexed migration to deduplicate.
      const match = await ctx.db
        .query("contacts")
        .withIndex("by_project_email", (q) =>
          q.eq("projectId", projectId).eq("email", normalizedEmail),
        )
        .first();
      if (match) return match._id;
    }
    return await ctx.db.insert("contacts", {
      projectId,
      ...rest,
      ...(normalizedEmail ? { email: normalizedEmail } : {}),
      createdAt: Date.now(),
    });
  },
});

const IMPORT_MAX_ROWS = 100;

/** Save a reviewed CSV batch atomically; input consent fields are not accepted. */
export const importBatch = moduleMutation("customers", {
  args: {
    projectId: v.id("projects"),
    rows: v.array(
      v.object({
        email: v.string(),
        name: v.optional(v.string()),
        company: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, { projectId, rows }, access) => {
    await access.requireProject(projectId);
    if (rows.length > IMPORT_MAX_ROWS) {
      throw new Error(`Import can contain at most ${IMPORT_MAX_ROWS} rows.`);
    }
    let inserted = 0;
    let skipped = 0;
    let invalid = 0;
    const seen = new Set<string>();
    for (const row of rows) {
      const email = normalizeCustomerEmail(row.email);
      const safeFields =
        (row.name?.length ?? 0) <= 160 &&
        (row.company?.length ?? 0) <= 160 &&
        (row.tags?.length ?? 0) <= 20 &&
        (row.tags ?? []).every((tag) => tag.length <= 40);
      if (!isValidCustomerEmail(email) || !safeFields) {
        invalid += 1;
        continue;
      }
      if (seen.has(email)) {
        skipped += 1;
        continue;
      }
      seen.add(email);
      const existing = await ctx.db
        .query("contacts")
        .withIndex("by_project_email", (q) =>
          q.eq("projectId", projectId).eq("email", email),
        )
        .first();
      if (existing) {
        skipped += 1;
        continue;
      }
      await ctx.db.insert("contacts", {
        projectId,
        email,
        name: row.name?.trim() || undefined,
        company: row.company?.trim() || undefined,
        tags: row.tags?.map((tag) => tag.trim()).filter(Boolean),
        createdAt: Date.now(),
      });
      inserted += 1;
    }
    return { inserted, skipped, invalid };
  },
});

export const update = moduleMutation("customers", {
  args: {
    id: v.id("contacts"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    company: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    const next: Record<string, unknown> = { ...clean };
    if (typeof patch.email === "string") {
      const normalizedEmail = normalizeCustomerEmail(patch.email);
      if (!isValidCustomerEmail(normalizedEmail)) {
        throw new Error("Enter a valid email address.");
      }
      next.email = normalizedEmail;
      if (normalizedEmail) {
        const duplicate = await ctx.db
          .query("contacts")
          .withIndex("by_project_email", (q) =>
            q.eq("projectId", row.projectId).eq("email", normalizedEmail),
          )
          .first();
        if (duplicate && duplicate._id !== id) {
          throw new Error(
            "A contact with this email already exists in the project.",
          );
        }
      }
    }
    if (Object.keys(next).length) await ctx.db.patch(id, next);
  },
});

export const remove = moduleMutation("customers", {
  args: { id: v.id("contacts") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
