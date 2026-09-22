"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { vly } from "../lib/vly-integrations";
import type { ProjectSnapshot } from "./ai";
import {
  actionProjectSnapshot,
  consumeAiQuotaForAction,
  requireActionUser,
} from "./guards";

/* ── shared helpers ──────────────────────────────────────────────────── */

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

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI returned an unreadable response");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

function projectLines(p: ProjectSnapshot): string {
  return [
    `Project: ${p.name}`,
    p.industry ? `Industry: ${p.industry}` : "",
    p.description ? `Description: ${p.description}` : "",
    p.websiteUrl ? `Website: ${p.websiteUrl}` : "",
    p.productsServices?.length
      ? `Products/services: ${p.productsServices.join(", ")}`
      : "",
    p.goals?.length ? `Marketing goals: ${p.goals.join(", ")}` : "",
    p.competitors?.length ? `Competitors: ${p.competitors.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* ── generateBuildPlan ───────────────────────────────────────────────── */

const STEPS = [
  "positioning",
  "pages",
  "content",
  "conversion",
  "seo",
] as const;

/**
 * Strategy-first blueprint: instead of jumping to code, the AI plans the
 * build from the business idea, the chosen personas and journeys, and the
 * differentiators vs. generic prompt-to-app tools. Returns positioning,
 * goals, differentiators and a concrete step list the user can execute
 * (and tick off) in the Build module.
 */
export const generateBuildPlan = action({
  args: {
    projectId: v.id("projects"),
    idea: v.string(),
    kind: v.union(v.literal("website"), v.literal("app")),
    name: v.string(),
    personas: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        role: v.optional(v.string()),
        goals: v.optional(v.array(v.string())),
        pains: v.optional(v.array(v.string())),
        objections: v.optional(v.array(v.string())),
      }),
    ),
    journeys: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        personaId: v.optional(v.string()),
        stages: v.array(
          v.object({
            stage: v.string(),
            score: v.optional(v.number()),
          }),
        ),
      }),
    ),
  },
  handler: async (ctx, { projectId, idea, kind, name, personas, journeys }) => {
    const userId = await requireActionUser(ctx);
    const project = await actionProjectSnapshot(ctx, userId, projectId);
    await consumeAiQuotaForAction(ctx, userId);
    const personaLines = personas
      .map(
        (p) =>
          `- [${p.id}] ${p.name}${p.role ? ` (${p.role})` : ""}${
            p.pains?.length ? ` — pains: ${p.pains.join("; ")}` : ""
          }${p.goals?.length ? ` — goals: ${p.goals.join("; ")}` : ""}`,
      )
      .join("\n");

    const journeyLines = journeys
      .map(
        (j) =>
          `- [${j.id}] ${j.name}${j.personaId ? ` (persona ${j.personaId})` : ""}\n${j.stages
            .map(
              (s) =>
                `    • ${s.stage}${typeof s.score === "number" ? ` (score ${s.score}/10)` : ""}`,
            )
            .join("\n")}`,
      )
      .join("\n");

    const text = await complete(
      `You are a senior product strategist for an AI app builder with a unique advantage: it plans builds from the business idea, buyer personas and customer journeys BEFORE any code or design exists — unlike competitors (caffeine.ai, Lovable, Ploy) that jump straight from prompt to UI.

Given the business context, the ${kind} idea, the personas and the journeys, produce a build plan. Return ONLY valid JSON shaped exactly as:
{
  "positioning": string,           // one crisp sentence: for whom, what, why it wins
  "goals": string[],               // 3-5 business goals this ${kind} must serve
  "differentiators": string[],     // 3-5 concrete reasons this build beats generic competitors (grounded in personas/journeys)
  "summary": string,               // 2-3 sentence blueprint summary
  "pages": [{                      // 4-8 pages/screens in priority order
    "name": string,
    "path": string,                // "/name" style path
    "goal": string,                // what the page must achieve
    "personaId": string|null,      // use provided ids or null
    "journeyStage": string|null    // journey stage name or null
  }]
}`,
      `${projectLines(project)}

${kind} idea: ${idea}
${kind} name: ${name}

Personas:
${personaLines || "(none yet — plan for the primary buyer)"}

Journeys:
${journeyLines || "(none yet)"}`,
      { temperature: 0.6, maxTokens: 1600 },
    );

    const raw = parseJson<{
      positioning?: string;
      goals?: unknown;
      differentiators?: unknown;
      summary?: string;
      pages?: Array<{
        name?: string;
        path?: string;
        goal?: string;
        personaId?: string | null;
        journeyStage?: string | null;
      }>;
    }>(text);

    const arr = (x: unknown): string[] =>
      Array.isArray(x)
        ? x.filter((i): i is string => typeof i === "string" && i.trim() !== "").slice(0, 6)
        : [];

    const pages = (raw.pages ?? [])
      .filter((p): p is NonNullable<typeof p> & { name: string } =>
        typeof p?.name === "string" && p.name.trim() !== "")
      .slice(0, 8)
      .map((p, i) => ({
        name: p.name.trim(),
        path:
          typeof p.path === "string" && p.path.trim() !== ""
            ? p.path.trim().startsWith("/")
              ? p.path.trim()
              : `/${p.path.trim()}`
            : `/${p.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        goal: typeof p.goal === "string" ? p.goal.trim() : undefined,
        personaId: typeof p.personaId === "string" ? p.personaId : undefined,
        journeyStage: typeof p.journeyStage === "string" ? p.journeyStage : undefined,
        order: i,
      }));

    const steps = STEPS.map((step, i) => ({
      step,
      title: STEP_TITLES[i],
      detail: STEP_DETAILS[i],
      status: "todo" as const,
    }));

    if (!raw.positioning?.trim()) throw new Error("AI returned no positioning");
    return {
      positioning: raw.positioning.trim(),
      goals: arr(raw.goals),
      differentiators: arr(raw.differentiators),
      summary: raw.summary?.trim() || "",
      pages,
      steps,
    };
  },
});

const STEP_TITLES = [
  "Lock the positioning",
  "Plan the pages",
  "Draft page content",
  "Design for conversion",
  "SEO & accessibility pass",
];

const STEP_DETAILS = [
  "Review the AI positioning statement and adjust until it feels right. Every page and sentence hangs off it.",
  "Approve the page plan — each page is tied to a persona and a journey stage, so nothing is generic filler.",
  "Generate AI drafts per page, grounded in the persona's pains and the journey stage's question.",
  "Check each page answers the persona's objections with proof: social proof, guarantees, clear CTAs.",
  "Run the SEO/WCAG 2.2 AA checks before publishing.",
];

/* ── generatePageDraft ───────────────────────────────────────────────── */

/**
 * Generate the HTML draft for one build page, grounded in the persona
 * (pains/objections) and journey stage the page targets.
 */
export const generatePageDraft = action({
  args: {
    projectId: v.id("projects"),
    build: v.object({
      name: v.string(),
      kind: v.union(v.literal("website"), v.literal("app")),
      positioning: v.optional(v.string()),
      differentiators: v.optional(v.array(v.string())),
    }),
    page: v.object({
      name: v.string(),
      path: v.string(),
      goal: v.optional(v.string()),
      journeyStage: v.optional(v.string()),
    }),
    persona: v.optional(
      v.object({
        name: v.string(),
        role: v.optional(v.string()),
        goals: v.optional(v.array(v.string())),
        pains: v.optional(v.array(v.string())),
        objections: v.optional(v.array(v.string())),
      }),
    ),
    userInstructions: v.optional(v.string()),
  },
  handler: async (ctx, { projectId, build, page, persona, userInstructions }) => {
    const userId = await requireActionUser(ctx);
    const project = await actionProjectSnapshot(ctx, userId, projectId);
    await consumeAiQuotaForAction(ctx, userId);
    const personaDesc = persona
      ? `Write for persona: ${persona.name}${persona.role ? ` (${persona.role})` : ""}${
          persona.pains?.length ? ` — pains: ${persona.pains.join("; ")}` : ""
        }${
          persona.objections?.length
            ? ` — objections to handle: ${persona.objections.join("; ")}`
            : ""
        }`
      : "";

    const text = await complete(
      `You are an expert conversion-focused web writer. Write the content for one page of a ${build.kind} as clean HTML using only <h1>, <h2>, <p>, <ul>, <ol>, <li>, <strong>, <em> tags. Start with an <h1>.
${build.positioning ? `Positioning to honor: ${build.positioning}` : ""}
${build.differentiators?.length ? `Differentiators to weave in naturally: ${build.differentiators.join("; ")}` : ""}
${personaDesc}
${page.journeyStage ? `This page targets the journey stage: ${page.journeyStage}.` : ""}
${page.goal ? `Page goal: ${page.goal}` : ""}
Structure: hero (h1 + subhead), then 2-4 sections matching the goal, ending with a clear CTA section. Return ONLY the HTML, no markdown fences, no explanation.`,
      `${projectLines(project)}

Page: ${page.name} (${page.path})
${userInstructions ? `User instructions: ${userInstructions}` : ""}`,
      { temperature: 0.7, maxTokens: 1800 },
    );

    const html = text
      .replace(/```html|```/g, "")
      .replace(/^[\s\S]*?<body>/i, "")
      .replace(/<\/body>[\s\S]*$/i, "")
      .trim();
    if (!html) throw new Error("AI returned empty content");
    return html;
  },
});
