import { moduleMutation, moduleQuery } from "./guards";
import { v } from "convex/values";

// Creative-brief fields shared by create and update (all optional).
const briefFields = {
  proofPoints: v.optional(v.array(v.string())),
  desiredResponse: v.optional(
    v.object({
      think: v.optional(v.string()),
      feel: v.optional(v.string()),
      do: v.optional(v.string()),
    }),
  ),
  callToAction: v.optional(v.string()),
  pillar: v.optional(v.string()),
};

function clip(value: string | undefined, max: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
}

/** Bound the brief fields: they are read into every AI prompt once the
 *  communication is active. */
function boundBrief(input: {
  proofPoints?: string[];
  desiredResponse?: { think?: string; feel?: string; do?: string };
  callToAction?: string;
  pillar?: string;
}) {
  return {
    proofPoints: input.proofPoints
      ?.map((point) => clip(point, 160))
      .filter((point): point is string => Boolean(point))
      .slice(0, 5),
    desiredResponse: input.desiredResponse && {
      think: clip(input.desiredResponse.think, 200),
      feel: clip(input.desiredResponse.feel, 200),
      do: clip(input.desiredResponse.do, 200),
    },
    callToAction: clip(input.callToAction, 120),
    pillar: clip(input.pillar, 120),
  };
}

export const list = moduleQuery("create", {
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }, access) => {
    const scope = await access.ownedProject(projectId);
    if (!scope) return [];
    return await ctx.db
      .query("communications")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const create = moduleMutation("create", {
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    message: v.string(),
    rationale: v.optional(v.string()),
    channels: v.optional(v.array(v.string())),
    audience: v.optional(v.string()),
    ...briefFields,
  },
  handler: async (ctx, { projectId, proofPoints, desiredResponse, callToAction, pillar, ...rest }, access) => {
    const { userId } = await access.requireProject(projectId);
    return await ctx.db.insert("communications", {
      projectId,
      ...rest,
      ...boundBrief({ proofPoints, desiredResponse, callToAction, pillar }),
      status: "draft" as const,
      createdBy: userId,
      createdAt: Date.now(),
    });
  },
});

export const update = moduleMutation("create", {
  args: {
    id: v.id("communications"),
    name: v.optional(v.string()),
    message: v.optional(v.string()),
    rationale: v.optional(v.string()),
    channels: v.optional(v.array(v.string())),
    audience: v.optional(v.string()),
    status: v.optional(
      v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    ),
    ...briefFields,
  },
  handler: async (ctx, { id, proofPoints, desiredResponse, callToAction, pillar, ...patch }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    const clean = Object.fromEntries(
      Object.entries({ ...patch, ...boundBrief({ proofPoints, desiredResponse, callToAction, pillar }) })
        .filter(([, v]) => v !== undefined),
    );
    if (Object.keys(clean).length) await ctx.db.patch(id, clean);
  },
});

export const remove = moduleMutation("create", {
  args: { id: v.id("communications") },
  handler: async (ctx, { id }, access) => {
    const row = await access.ownedRow(await ctx.db.get(id));
    if (!row) throw new Error("Not found");
    await ctx.db.delete(id);
  },
});
