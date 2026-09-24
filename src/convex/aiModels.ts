import { v } from "convex/values";
import {
  action,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  operatorEmailFor,
  projectAiModelChoice,
  requireActionUser,
  requirePlatformAdmin,
  requireUser,
  resolvePlatformAdmin,
} from "./guards";
import {
  FALLBACK_MODEL_ID,
  isValidModelId,
  parseOpenRouterCatalog,
  type OpenRouterCatalogEntry,
} from "./lib/aiModelCatalog";

/**
 * AI model allow-list (owner decision, 24 Sep 2026): the platform admin picks
 * which OpenRouter models may be used and which is the default; each project
 * can choose one of the enabled models. The model gateway resolves the model
 * on the server from this table — feature code no longer hard-codes one, and a
 * client can never name an arbitrary model.
 */

const MAX_MODELS = 30;

async function recordAudit(
  ctx: MutationCtx,
  actorId: Id<"users">,
  action: string,
  detail: string,
) {
  await ctx.db.insert("adminAuditLog", {
    actorId,
    actorEmail: (await operatorEmailFor(ctx, actorId)) ?? undefined,
    action,
    targetType: "aiModels",
    detail: detail.slice(0, 500),
    createdAt: Date.now(),
  });
}

async function enabledModels(ctx: QueryCtx): Promise<Doc<"aiModels">[]> {
  const rows = await ctx.db.query("aiModels").take(MAX_MODELS * 2);
  return rows
    .filter((row) => row.enabled)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label));
}

/** The model a request should use: the project's choice while it is still
 *  enabled, else the admin default, else the first enabled model, else the
 *  built-in fallback (so a fresh deployment works before any setup). */
export async function resolveModelId(
  ctx: QueryCtx,
  projectId: Id<"projects"> | undefined,
): Promise<string> {
  const enabled = await enabledModels(ctx);
  if (projectId) {
    const chosen = await projectAiModelChoice(ctx, projectId);
    if (chosen && enabled.some((row) => row.modelId === chosen)) return chosen;
  }
  return enabled.find((row) => row.isDefault)?.modelId ?? enabled[0]?.modelId ?? FALLBACK_MODEL_ID;
}

/** Gateway-only resolver (called from actions via ctx.runQuery). */
export const resolveForRequest = internalQuery({
  args: { projectId: v.optional(v.id("projects")) },
  handler: async (ctx, { projectId }) => ({ modelId: await resolveModelId(ctx, projectId) }),
});

/** Enabled models, for the per-project picker. Any signed-in user. */
export const listAvailable = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const enabled = await enabledModels(ctx);
    if (!enabled.length) {
      return [{ modelId: FALLBACK_MODEL_ID, label: "Standard (default)", isDefault: true, description: undefined }];
    }
    return enabled.map((row) => ({
      modelId: row.modelId,
      label: row.label,
      isDefault: row.isDefault,
      description: row.description,
    }));
  },
});

/* ── Operator (platform admin) management ───────────────────────────────── */

export const adminList = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const rows = await ctx.db.query("aiModels").take(MAX_MODELS * 2);
    return {
      fallbackModelId: FALLBACK_MODEL_ID,
      models: rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.label.localeCompare(b.label)),
    };
  },
});

export const adminUpsert = mutation({
  args: {
    modelId: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    enabled: v.boolean(),
    contextLength: v.optional(v.number()),
    promptUsdPerMillion: v.optional(v.number()),
    completionUsdPerMillion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actorId = await requirePlatformAdmin(ctx);
    const modelId = args.modelId.trim();
    const label = args.label.trim().slice(0, 80);
    if (!isValidModelId(modelId)) throw new Error("Use an OpenRouter model id like provider/model-name.");
    if (!label) throw new Error("Give the model a name users will recognise.");
    const price = (value: number | undefined) =>
      value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
    const fields = {
      label,
      description: args.description?.trim().slice(0, 200) || undefined,
      enabled: args.enabled,
      contextLength:
        args.contextLength !== undefined && Number.isInteger(args.contextLength) && args.contextLength > 0
          ? args.contextLength
          : undefined,
      promptUsdPerMillion: price(args.promptUsdPerMillion),
      completionUsdPerMillion: price(args.completionUsdPerMillion),
      updatedAt: Date.now(),
      updatedBy: actorId,
    };
    const existing = await ctx.db
      .query("aiModels")
      .withIndex("by_model", (q) => q.eq("modelId", modelId))
      .unique();
    if (existing) {
      if (existing.isDefault && !args.enabled) {
        throw new Error("This is the default model. Choose another default before disabling it.");
      }
      await ctx.db.patch(existing._id, fields);
      await recordAudit(ctx, actorId, "ai_model.update", `${modelId}; enabled=${args.enabled}`);
      return existing._id;
    }
    const count = (await ctx.db.query("aiModels").take(MAX_MODELS + 1)).length;
    if (count >= MAX_MODELS) throw new Error(`Up to ${MAX_MODELS} models can be listed.`);
    const anyDefault = (await ctx.db.query("aiModels").take(MAX_MODELS)).some((row) => row.isDefault);
    const id = await ctx.db.insert("aiModels", {
      modelId,
      ...fields,
      // The first enabled model becomes the default so resolution is explicit.
      isDefault: !anyDefault && args.enabled,
      createdAt: Date.now(),
    });
    await recordAudit(ctx, actorId, "ai_model.add", `${modelId}; enabled=${args.enabled}`);
    return id;
  },
});

export const adminSetDefault = mutation({
  args: { id: v.id("aiModels") },
  handler: async (ctx, { id }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) throw new Error("Not found");
    if (!row.enabled) throw new Error("Enable the model before making it the default.");
    for (const other of await ctx.db.query("aiModels").take(MAX_MODELS * 2)) {
      if (other.isDefault && other._id !== id) await ctx.db.patch(other._id, { isDefault: false });
    }
    await ctx.db.patch(id, { isDefault: true, updatedAt: Date.now(), updatedBy: actorId });
    await recordAudit(ctx, actorId, "ai_model.set_default", row.modelId);
  },
});

export const adminRemove = mutation({
  args: { id: v.id("aiModels") },
  handler: async (ctx, { id }) => {
    const actorId = await requirePlatformAdmin(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.isDefault) throw new Error("Choose another default before removing this model.");
    await ctx.db.delete(id);
    await recordAudit(ctx, actorId, "ai_model.remove", row.modelId);
  },
});

/** Operator check usable from an action. */
export const isOperator = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => resolvePlatformAdmin(ctx, userId),
});

/** Browse OpenRouter's public model catalog (no key needed) to pick models
 *  with their real context length and prices. Fixed URL, operator only. */
export const adminCatalog = action({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }): Promise<OpenRouterCatalogEntry[]> => {
    const userId = await requireActionUser(ctx);
    if (!(await ctx.runQuery(internal.aiModels.isOperator, { userId }))) {
      throw new Error("Platform admin only");
    }
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/models", {
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("OpenRouter's model list didn't respond. Try again.");
    }
    if (!response.ok) throw new Error("OpenRouter's model list is unavailable right now.");
    return parseOpenRouterCatalog(await response.json(), search);
  },
});
