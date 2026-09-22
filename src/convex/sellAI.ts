"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { moduleAction, requireActionUser } from "./guards";
import { vly } from "../lib/vly-integrations";
import type { Id } from "./_generated/dataModel";

/* ── M1 Sell AI actions — M1-BLUEPRINT §8/§9, SELL-ARCHITECTURE §6 ────────
 *
 * Invariants enforced HERE, server-side (defense in depth):
 *  - Surgical: the caller passes the product's CURRENT fields; the action
 *    REFUSES to generate a field that already has content (fill-missing
 *    semantics; improve only rewrites copy it was given).
 *  - Never fabricated: the prompt forbids GTIN/SKU/price/inventory/shipping/
 *    warranty, and these actions structurally cannot write to variants —
 *    they only return text proposals for review.
 *  - Proposal-only: nothing here writes to the DB. The client applies via
 *    products.update with origin:"ai" after the user reviews.
 *
 * Per-field on demand only. Batch operations are excluded in M1. */

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
    maxTokens: opts.maxTokens ?? 700,
  });
  if (!res.success || !res.data) {
    throw new Error(res.error ?? "AI request failed");
  }
  return res.data.choices[0]?.message?.content?.trim() ?? "";
}

const NEVER_FABRICATE = `
STRICT RULES:
- Never invent or guess: GTIN/barcode, SKU/MPN, price, inventory counts,
  shipping times, warranty terms, certifications, materials, dimensions,
  availability dates, or any legal claim.
- Only write about what is supported by the information provided.
- If information is missing, omit rather than invent.
- Output plain text only — no markdown headers, no commentary.`;

async function productContextOf(
  projectId: Id<"projects">,
): Promise<{ name?: string; industry?: string; description?: string; businessName?: string }> {
  // The action context is db-free per ai.ts house pattern — the client
  // passes project context inline instead. Kept for future enrichment.
  void projectId;
  return {};
}

/** Proposal for a product description. Refuses when a real description
 *  already exists unless mode:"improve" — and improve never overwrites
 *  server-side; it returns a proposal for review. */
export const generateDescription = moduleAction("sell", {
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    brand: v.optional(v.string()),
    productType: v.optional(v.string()),
    currentDescription: v.optional(v.string()),
    mode: v.union(v.literal("fill_missing"), v.literal("improve")),
    project: v.object({
      name: v.string(),
      industry: v.optional(v.string()),
      description: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    void productContextOf;
    // T2.2 authorized the project; T2.3's `moduleAction` enforces `sell.edit`
    // for the acting organization's plan and the caller's role BEFORE the
    // provider call (the builder resolves the tenant from `projectId`), so a
    // member of another organization (or a locked plan) cannot bill this
    // project's AI budget.

    if (args.mode === "fill_missing") {
      const existing = args.currentDescription?.trim() ?? "";
      // Server-side refusal: never regenerate what the user already has
      if (existing.length >= 80) {
        throw new Error(
          "Description already exists — use mode 'improve' to get a proposal.",
        );
      }
    } else if (!args.currentDescription?.trim()) {
      throw new Error("Nothing to improve — description is empty.");
    }

    const context = [
      `Business: ${args.project.name}`,
      args.project.industry ? `Industry: ${args.project.industry}` : "",
      args.project.description
        ? `About: ${args.project.description}`
        : "",
      `Product: ${args.title}`,
      args.brand ? `Brand: ${args.brand}` : "",
      args.productType ? `Type: ${args.productType}` : "",
      args.currentDescription?.trim()
        ? `Current description (keep its factual claims, improve structure and persuasion): ${args.currentDescription}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const text = await complete(
      `You write ecommerce product descriptions for a small business.${NEVER_FABRICATE}`,
      `${context}\n\nWrite a product description of 60–150 words that addresses the most likely buyer objection and ends with a benefit. Plain text.`,
      { maxTokens: 500 },
    );
    return { description: text };
  },
});

/** Alt text — requires an existing image URL (evidence: the image is real,
 *  though M1 has no vision pass; we describe from product context). */
export const generateAltText = action({
  args: {
    imageUrl: v.string(),
    title: v.string(),
    productType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireActionUser(ctx);
    if (!args.imageUrl) {
      throw new Error("Alt text requires an existing product image.");
    }
    const text = await complete(
      `You write concise, accessible image alt text for ecommerce.${NEVER_FABRICATE}`,
      `Product: ${args.title}${args.productType ? ` (${args.productType})` : ""}\nImage URL: ${args.imageUrl}\n\nWrite ONE alt-text sentence (max 125 chars) describing what the product image likely shows. Plain text.`,
      { maxTokens: 120, temperature: 0.4 },
    );
    return { alt: text };
  },
});

/** SEO title + description into enrichment. Fill-missing only. */
export const generateSeo = action({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    currentSeoTitle: v.optional(v.string()),
    currentSeoDescription: v.optional(v.string()),
    project: v.object({
      name: v.string(),
      industry: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    await requireActionUser(ctx);
    if (args.currentSeoTitle?.trim() && args.currentSeoDescription?.trim()) {
      throw new Error("SEO fields already filled — nothing to generate.");
    }

    const wantsTitle = !args.currentSeoTitle?.trim();
    const wantsDesc = !args.currentSeoDescription?.trim();

    const text = await complete(
      `You write SEO metadata for ecommerce product pages.${NEVER_FABRICATE}`,
      `Business: ${args.project.name}${args.project.industry ? ` (${args.project.industry})` : ""}\nProduct: ${args.title}\n${args.description ? `Description: ${args.description.slice(0, 500)}` : ""}\n\nReturn ${[wantsTitle && "a SEO title (max 60 chars)", wantsDesc && "a meta description (max 155 chars)"].filter(Boolean).join(" and ")}. Format exactly:\nTITLE: <title>\nDESCRIPTION: <description>`,
      { maxTokens: 200, temperature: 0.5 },
    );

    const title = wantsTitle
      ? text.match(/TITLE:\s*(.+)/)?.[1]?.trim()
      : undefined;
    const description = wantsDesc
      ? text.match(/DESCRIPTION:\s*(.+)/)?.[1]?.trim()
      : undefined;

    return {
      seoTitle: title,
      seoDescription: description,
    };
  },
});
