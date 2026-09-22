
import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { copilotDefaultModel } from "./platforms";
import { requireUser } from "../guards";

/**
 * Ads Copilot: AI analyst over the project's normalized ad data.
 *
 * - Model comes from admin settings (appSettings.copilotModel), called via
 *   OpenRouter. Falls back to the default when unset.
 * - Read-only analysis: the model sees campaign metrics, never credentials.
 * - Proposals are structured JSON validated server-side; anything actionable
 *   becomes a draft change request — never a direct write.
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Read the admin-selected copilot model. Dashboard-only, so it requires a
 *  signed-in account (the audit script flags any public function that reads
 *  without establishing identity — review T0.6). */
export const copilotModel = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "ads"))
      .first();
    return row?.copilotModel ?? copilotDefaultModel();
  },
});

/** Admin: set the copilot model. */
export const setCopilotModel = mutation({
  args: { model: v.string() },
  handler: async (ctx, { model }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const user = await ctx.db.get(userId);
    if (user?.role !== "admin") throw new Error("Admin only");
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "ads"))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { copilotModel: model, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("appSettings", {
        key: "ads",
        copilotModel: model,
        updatedAt: Date.now(),
      });
    }
  },
});

/** Chat history for the copilot panel. */
export const listMessages = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) return [];
    const rows = await ctx.db
      .query("adsCopilotMessages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** Clear the copilot thread. */
export const clearMessages = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const rows = await ctx.db
      .query("adsCopilotMessages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
  },
});

/** Ask the copilot. The server builds the context from normalized data —
 *  the client never sends provider data and never sees tokens. */
type CopilotCampaign = {
  platform: string;
  campaignId: string;
  accountId: string;
  name: string;
  status: string;
  dailyBudgetCents: number | undefined;
  metrics: {
    spendCents: number;
    impressions: number;
    clicks: number;
    conversions: number;
    ctr: number;
    cpcCents: number;
    cpaCents: number;
  };
};

type CopilotHistory = Array<{ role: "user" | "assistant"; content: string }>;

export const ask = action({
  args: {
    projectId: v.id("projects"),
    message: v.string(),
  },
  handler: async (
    ctx,
    { projectId, message },
  ): Promise<{ reply: string; changeRequestId: Id<"adsChangeRequests"> | undefined }> => {
    const userId = (await getAuthUserId(ctx as never)) as Id<"users">;
    if (!userId) throw new Error("Not signed in");
    await ctx.runQuery(internal.billing.checkModule, {
      userId,
      module: "promote",
    });
    const project = await ctx.runQuery(internal.ads.control.getProject, {
      projectId,
    });
    if (!project || project.ownerId !== userId) throw new Error("Not found");
    const trimmed = message.trim();
    if (!trimmed) throw new Error("Empty message");
    if (trimmed.length > 4000) throw new Error("Message too long");

    // 1. Build context from normalized MOSAI data
    const campaigns = (await ctx.runQuery(internal.ads.copilot.campaigns, {
      projectId,
    })) as CopilotCampaign[];
    const history = (await ctx.runQuery(internal.ads.copilot.history, {
      projectId,
    })) as CopilotHistory;

    const contextBlock = campaigns.length
      ? campaigns
          .map(
            (c) =>
              `- [${c.platform}] ${c.name} (${c.campaignId}) status=${c.status}, daily_budget=${c.dailyBudgetCents != null ? c.dailyBudgetCents : "unset"} (minor units), last14d: spend=${(c.metrics.spendCents / 100).toFixed(2)}, impressions=${c.metrics.impressions}, clicks=${c.metrics.clicks}, conversions=${c.metrics.conversions.toFixed(1)}, ctr=${c.metrics.ctr.toFixed(2)}%, cpc=${(c.metrics.cpcCents / 100).toFixed(2)}, cpa=${c.metrics.cpaCents > 0 ? (c.metrics.cpaCents / 100).toFixed(2) : "n/a"}`,
          )
          .join("\n")
      : "(no campaigns synced yet)";

    const system = `You are MOSAI's Ads Copilot, an expert paid-media analyst embedded in a marketing workspace.

Rules:
1. You analyze performance and PROPOSE changes. You never execute anything.
2. If the user asks you to change a campaign (pause, resume, budget), output a JSON block on its own line:
{"proposal": true, "platform": "google|meta|tiktok|chatgpt", "campaign_id": string, "campaign_name": string, "kind": "pause|resume|set_daily_budget", "payload": number|null, "rationale": string}
payload = daily budget in minor units (e.g. €35.00 → 3500). Only include payload for set_daily_budget.
Use the exact platform and campaign_id from the context. At most one proposal per reply.
3. For normal analysis, answer concisely with concrete numbers from the context. If days of data < 14, note the window is partial.
4. If the context is empty, tell the user to connect a platform and run a sync first.
5. Never invent metrics. If a number isn't in the context, say so.

Budgets in the context are minor units (cents). Reason about them as the account's currency with a decimal point two places left.`;

    const userBlock = `PROJECT CONTEXT
Name: ${project.name}
Business: ${project.description ?? "(no description)"}
Website: ${project.websiteUrl ?? "(none)"}
Industry: ${project.industry ?? "(none)"}

SYNCED CAMPAIGNS (last 14 days rollup)
${contextBlock}`;

    // 2. Call OpenRouter with the admin-selected model
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not configured in this deployment — add it in the Keys/API keys settings.",
      );
    }
    const modelRow = await ctx.runQuery(internal.ads.copilot.model, {});
    const model = modelRow ?? copilotDefaultModel();

    let reply: string;
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://mosai.app",
          "X-Title": "MOSAI Ads Copilot",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            ...history
              .slice(-12)
              .map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            { role: "user", content: `${userBlock}\n\nUSER MESSAGE\n${trimmed}` },
          ],
          max_tokens: 900,
          temperature: 0.4,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `OpenRouter request failed (${res.status}): ${body.slice(0, 300)}`,
        );
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      reply = data.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Copilot request failed");
    }
    if (!reply) throw new Error("Copilot returned an empty response");

    // 3. Validate + parse an optional proposal block
    let changeRequestId: Id<"adsChangeRequests"> | undefined;
    let cleanReply = reply;
    const proposalMatch = reply.match(/\{[^{}]*"proposal"[\s\S]*?\}/);
    if (proposalMatch) {
      try {
        const raw = JSON.parse(proposalMatch[0]) as {
          proposal?: boolean;
          platform?: string;
          campaign_id?: string;
          campaign_name?: string;
          kind?: string;
          payload?: number | null;
          rationale?: string;
        };
        if (
          raw.proposal === true &&
          raw.platform &&
          raw.campaign_id &&
          raw.campaign_name &&
          (raw.kind === "pause" || raw.kind === "resume" || raw.kind === "set_daily_budget")
        ) {
          const valid = campaigns.find(
            (c) => c.platform === raw.platform && c.campaignId === raw.campaign_id,
          );
          if (valid) {
            const payload =
              raw.kind === "set_daily_budget" && typeof raw.payload === "number"
                ? Math.round(raw.payload)
                : undefined;
            changeRequestId = await ctx.runMutation(
              internal.ads.copilot.createDraftFromProposal,
              {
                projectId,
                platform: raw.platform,
                accountId: valid.accountId,
                campaignId: raw.campaign_id,
                campaignName: raw.campaign_name,
                kind: raw.kind,
                payload,
                beforeValue: valid.dailyBudgetCents,
                rationale:
                  raw.rationale?.slice(0, 500) ??
                  "Proposed by the Ads Copilot from campaign analysis.",
              },
            );
            cleanReply = reply.replace(proposalMatch[0], "").trim();
          }
        }
      } catch {
        // Malformed proposal → ignore, keep the text reply.
      }
    }

    // 4. Persist the exchange
    await ctx.runMutation(internal.ads.copilot.appendMessage, {
      projectId,
      role: "user",
      content: trimmed,
    });
    await ctx.runMutation(internal.ads.copilot.appendMessage, {
      projectId,
      role: "assistant",
      content: cleanReply,
      changeRequestId,
    });

    return { reply: cleanReply, changeRequestId };
  },
});

/* ── internal context helpers ─────────────────────────────────────────── */

export const campaigns = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const all = await ctx.db
      .query("adsCampaigns")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const metrics = await ctx.db
      .query("adsMetrics")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return all.map((c) => {
      const rows = metrics.filter(
        (m) => m.platform === c.platform && m.campaignId === c.campaignId,
      );
      const spendCents = rows.reduce((s, m) => s + m.spendCents, 0);
      const impressions = rows.reduce((s, m) => s + m.impressions, 0);
      const clicks = rows.reduce((s, m) => s + m.clicks, 0);
      const conversions = rows.reduce((s, m) => s + m.conversions, 0);
      return {
        platform: c.platform,
        campaignId: c.campaignId,
        accountId: c.accountId,
        name: c.name,
        status: c.status,
        dailyBudgetCents: c.dailyBudgetCents,
        metrics: {
          spendCents,
          impressions,
          clicks,
          conversions,
          ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
          cpcCents: clicks > 0 ? spendCents / clicks : 0,
          cpaCents: conversions > 0 ? spendCents / conversions : 0,
        },
      };
    });
  },
});

export const history = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const rows = await ctx.db
      .query("adsCopilotMessages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return rows
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-16)
      .map((r) => ({ role: r.role, content: r.content }));
  },
});

export const model = internalQuery({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", "ads"))
      .first();
    return row?.copilotModel;
  },
});

export const appendMessage = internalMutation({
  args: {
    projectId: v.id("projects"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    changeRequestId: v.optional(v.id("adsChangeRequests")),
  },
  handler: async (ctx, { projectId, role, content, changeRequestId }) => {
    await ctx.db.insert("adsCopilotMessages", {
      projectId,
      role,
      content,
      changeRequestId,
      createdAt: Date.now(),
    });
  },
});

export const createDraftFromProposal = internalMutation({
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    accountId: v.string(),
    campaignId: v.string(),
    campaignName: v.string(),
    kind: v.union(
      v.literal("pause"),
      v.literal("resume"),
      v.literal("set_daily_budget"),
    ),
    payload: v.optional(v.number()),
    beforeValue: v.optional(v.number()),
    rationale: v.string(),
  },
  handler: async (ctx, args) => {
    // Budget guardrail enforced again here — the copilot cannot bypass it.
    if (args.kind === "set_daily_budget") {
      if (!args.payload || args.payload < 100 || args.payload > 1_000_000) {
        throw new Error("Copilot budget proposal out of allowed range");
      }
    }
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not signed in");
    return await ctx.db.insert("adsChangeRequests", {
      projectId: args.projectId,
      platform: args.platform,
      accountId: args.accountId,
      campaignId: args.campaignId,
      campaignName: args.campaignName,
      kind: args.kind,
      payload: args.payload,
      beforeValue: args.beforeValue,
      rationale: args.rationale,
      origin: "copilot",
      status: "draft",
      requestedBy: userId,
      createdAt: Date.now(),
    });
  },
});
