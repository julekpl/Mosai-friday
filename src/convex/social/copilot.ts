"use node";

import { v } from "convex/values";
import { action } from "../_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { vly } from "../../lib/vly-integrations";
import { isSocialPlatform, SOCIAL_PLATFORM_META } from "./platforms";

/**
 * Social copilot — AI as assistant, never publisher (same house rule as the
 * Ads copilot). Every AI output lands as a DRAFT (origin: "copilot"); the
 * user is the gate that schedules or publishes. Schedule suggestions are
 * returned as data — applying them is an explicit user action.
 */

async function complete(
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const res = await vly.ai.completion({
    model: "gpt-4o-mini",
    messages: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ],
    temperature: opts.temperature ?? 0.7,
    maxTokens: opts.maxTokens ?? 1200,
  });
  if (!res.success || !res.data) {
    throw new Error(res.error ?? "AI request failed");
  }
  return res.data.choices[0]?.message?.content?.trim() ?? "";
}

/* ── 1. Platform variants: one approved source → drafts per platform ──── */

export const draftVariants = action({
  args: {
    projectId: v.id("projects"),
    contentId: v.optional(v.id("contentPieces")),
    sourceText: v.string(),
    personaId: v.optional(v.id("personas")),
    campaignId: v.optional(v.id("campaigns")),
    platforms: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = (await getAuthUserId(ctx)) as Id<"users">;
    await ctx.runQuery(internal.billing.checkModule, {
      userId,
      module: "promote",
    });

    const platforms = args.platforms.filter(isSocialPlatform);
    if (platforms.length === 0) throw new Error("No valid platforms selected");
    if (!args.sourceText.trim()) throw new Error("Source text is empty");

    // Ground the AI in persona + campaign context (best effort).
    const persona = args.personaId
      ? ((await ctx.runQuery(internal.social.copilotData.getPersona, {
          personaId: args.personaId,
        })) as { name: string; role?: string; goals?: string[]; pains?: string[] } | null)
      : null;
    const campaign = args.campaignId
      ? ((await ctx.runQuery(internal.social.copilotData.getCampaign, {
          campaignId: args.campaignId,
        })) as { name: string; channel: string } | null)
      : null;

    const system = [
      "You adapt marketing content into native posts for different social platforms.",
      "Rules:",
      "- Preserve the source message's core claim; never invent facts or offers.",
      "- Match each platform's native voice and length.",
      "- Output ONLY a JSON array like [{\"platform\":\"linkedin\",\"body\":\"...\"}, ...] — no prose, no markdown fences.",
      "- Keys must be exactly the requested platforms.",
    ].join("\n");

    const contextLines = [
      `Source content:\n"""\n${args.sourceText.slice(0, 4000)}\n"""`,
      persona
        ? `Target persona: ${persona.name}${persona.role ? ` (${persona.role})` : ""}. Goals: ${(persona.goals ?? []).join("; ") || "n/a"}. Pains: ${(persona.pains ?? []).join("; ") || "n/a"}.`
        : "Target persona: general audience.",
      campaign ? `Campaign: "${campaign.name}" (${campaign.channel}).` : "",
      `Platforms (adapt for each): ${platforms.join(", ")}.`,
      "Platform guidance: LinkedIn = professional, 1-3 short paragraphs, insight-led. X = max 280 chars, punchy. Facebook = conversational, community feel. Instagram = caption style, emoji-light, hashtag line at end. TikTok = short video caption, hook first.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const raw = await complete(system, contextLines, { temperature: 0.7 });

    let variants: Array<{ platform: string; body: string }>;
    try {
      const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
      variants = JSON.parse(cleaned) as Array<{ platform: string; body: string }>;
    } catch {
      throw new Error("AI returned an unparseable response — try again.");
    }

    // Persist each variant as an honest, reviewable DRAFT. Nothing schedules.
    const created: Array<{ postId: Id<"posts">; platform: string }> = [];
    for (const variant of variants) {
      if (!isSocialPlatform(variant.platform) || !variant.body?.trim()) continue;
      const postId = (await ctx.runMutation(internal.social.copilotData.insertCopilotDraft, {
        projectId: args.projectId,
        contentId: args.contentId,
        campaignId: args.campaignId,
        channel: variant.platform,
        body: variant.body.trim(),
        createdBy: userId,
      })) as Id<"posts">;
      created.push({ postId, platform: variant.platform });
    }

    if (created.length === 0) {
      throw new Error("AI produced no usable variants — try again.");
    }
    return { created };
  },
});

/* ── 2. Best-time suggestion per platform (advice, never auto-scheduling) ─ */

export const suggestSchedule = action({
  args: {
    projectId: v.id("projects"),
    platform: v.string(),
    body: v.string(),
  },
  handler: async (ctx, { projectId, platform, body }) => {
    const userId = (await getAuthUserId(ctx)) as Id<"users">;
    await ctx.runQuery(internal.billing.checkModule, {
      userId,
      module: "promote",
    });
    if (!isSocialPlatform(platform)) throw new Error("Unknown platform");

    const label = SOCIAL_PLATFORM_META[platform].label;
    const raw = await complete(
      "You are a social media scheduling advisor. Given a post and its platform, suggest ONE concrete posting time. " +
        "Consider the platform's typical engagement patterns. Do NOT claim access to real analytics. " +
        'Output ONLY JSON: {"suggestedFor":"<ISO 8601 datetime, within the next 7 days>","reason":"<one sentence>"} — no markdown fences.',
      `Platform: ${label}\nNow: ${new Date().toISOString()}\nPost:\n"""\n${body.slice(0, 1500)}\n"""`,
      { temperature: 0.4, maxTokens: 300 },
    );

    try {
      const cleaned = raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim();
      const parsed = JSON.parse(cleaned) as { suggestedFor?: string; reason?: string };
      const ts = parsed.suggestedFor ? new Date(parsed.suggestedFor).getTime() : NaN;
      if (!Number.isFinite(ts)) throw new Error("bad time");
      return { suggestedFor: ts, reason: parsed.reason ?? "" };
    } catch {
      throw new Error("AI returned an unparseable schedule suggestion — try again.");
    }
  },
});

/* Internal queries + the draft-insert mutation live in copilot-data.ts —
   Convex forbids queries/mutations in "use node" files. */
