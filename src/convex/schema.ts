import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove

      // MOSAI additions — local billing mirror (source of truth: Stripe when wired)
      plan: v.optional(v.string()), // free | starter | growth | scale
      planStatus: v.optional(
        v.union(
          v.literal("active"),
          v.literal("trialing"),
          v.literal("canceled"),
          v.literal("past_due"),
        ),
      ),
      stripeCustomerId: v.optional(v.string()),
      deletionRequestedAt: v.optional(v.number()),
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ── MOSAI: the spine. Everything hangs off projects. ─────────────────

    projects: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      businessName: v.optional(v.string()),
      description: v.optional(v.string()),
      websiteUrl: v.optional(v.string()),
      industry: v.optional(v.string()),
      competitors: v.optional(v.array(v.string())),
      // Competitor entries tagged as either website URLs or GMB business names
      competitorEntries: v.optional(
        v.array(
          v.object({
            type: v.union(v.literal("website"), v.literal("gmb")),
            value: v.string(), // normalized https://… for websites, raw name for GMB
          }),
        ),
      ),
      googleBusinessName: v.optional(v.string()),
      productsServices: v.optional(v.array(v.string())),
      goals: v.optional(v.array(v.string())),
      kpis: v.optional(v.array(v.string())),
      channels: v.optional(v.array(v.string())),
      // Result of the last onboarding website scan (scraper + SerpApi)
      websiteScan: v.optional(
        v.object({
          status: v.union(
            v.literal("pending"),
            v.literal("scraped"),
            v.literal("partial"),
            v.literal("failed"),
          ),
          scannedAt: v.number(),
          sitemapUrls: v.optional(v.array(v.string())),
          titles: v.optional(v.array(v.string())),
          metaDescription: v.optional(v.string()),
          headings: v.optional(v.array(v.string())),
          // detected product / service names extracted from the site or GMB
          productsServices: v.optional(v.array(v.string())),
          gmb: v.optional(
            v.object({
              title: v.optional(v.string()),
              address: v.optional(v.string()),
              phone: v.optional(v.string()),
              website: v.optional(v.string()),
              rating: v.optional(v.number()),
              reviews: v.optional(v.number()),
              category: v.optional(v.string()),
              openHours: v.optional(v.string()),
            }),
          ),
        }),
      ),
      createdAt: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_owner_name", ["ownerId", "name"]),

    personas: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      role: v.optional(v.string()),
      goals: v.optional(v.array(v.string())),
      pains: v.optional(v.array(v.string())),
      objections: v.optional(v.array(v.string())),
      channels: v.optional(v.array(v.string())),
      evidence: v.optional(v.string()),
      journeyStages: v.optional(
        v.array(
          v.object({
            stage: v.string(),
            question: v.string(),
            answer: v.optional(v.string()),
          }),
        ),
      ),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    contentPieces: defineTable({
      projectId: v.id("projects"),
      personaId: v.optional(v.id("personas")),
      topicId: v.optional(v.id("contentTopics")),
      gapId: v.optional(v.id("contentGaps")),
      journeyMapId: v.optional(v.id("journeyMaps")),
      journeyStage: v.optional(v.string()),
      title: v.string(),
      topic: v.optional(v.string()),
      brief: v.optional(v.string()),
      body: v.optional(v.string()),
      // landing_page | script | social_post | social_series | blog | email | video_script
      contentType: v.optional(v.string()),
      // draft | approved | published
      status: v.union(
        v.literal("draft"),
        v.literal("approved"),
        v.literal("published"),
      ),
      // which surface this content feeds: website | email | social | ads
      surface: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_project", ["projectId"]),

    // OAuth / data-connection lifecycle. Modules read status from here,
    // never from a vendor SDK directly.
    connections: defineTable({
      projectId: v.id("projects"),
      provider: v.string(), // ga4 | gsc | gads | meta | tiktok | posthog | matomo | gtm
      status: v.union(
        v.literal("connected"),
        v.literal("disconnected"),
        v.literal("error"),
      ),
      accountLabel: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
      detail: v.optional(v.string()),
    })
      .index("by_project", ["projectId"])
      .index("by_project_provider", ["projectId", "provider"]),

    // ── Module tables: present now, activated per plan/module choice ────

    contacts: defineTable({
      projectId: v.id("projects"),
      name: v.optional(v.string()),
      email: v.optional(v.string()),
      company: v.optional(v.string()),
      // marketing consent — canonical, owned here, never delegated
      consent: v.optional(
        v.object({
          marketing: v.boolean(),
          updatedAt: v.number(),
          source: v.optional(v.string()),
        }),
      ),
      tags: v.optional(v.array(v.string())),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_email", ["projectId", "email"]),

    campaigns: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      channel: v.string(), // email | social | ads
      // draft | running | paused | done
      status: v.union(
        v.literal("draft"),
        v.literal("running"),
        v.literal("paused"),
        v.literal("done"),
      ),
      budgetCents: v.optional(v.number()),
      personaId: v.optional(v.id("personas")),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    posts: defineTable({
      projectId: v.id("projects"),
      contentId: v.optional(v.id("contentPieces")),
      channel: v.string(), // meta | tiktok | linkedin | x
      body: v.string(),
      scheduledFor: v.optional(v.number()),
      // draft | scheduled | published | failed
      status: v.union(
        v.literal("draft"),
        v.literal("scheduled"),
        v.literal("published"),
        v.literal("failed"),
      ),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    products: defineTable({
      projectId: v.id("projects"),
      title: v.string(),
      priceCents: v.optional(v.number()),
      feedUrl: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // Grow module — module-generated insights. definition + source + freshness
    // are the product: every insight says where its numbers came from.
    insights: defineTable({
      projectId: v.id("projects"),
      kind: v.union(
        v.literal("seo"),
        v.literal("geo"),
        v.literal("content_gap"),
        v.literal("channel"),
        v.literal("recommendation"),
      ),
      title: v.string(),
      body: v.optional(v.string()),
      // data source this insight is derived from — never blended silently
      source: v.string(), // ga4 | gsc | gads | meta | tiktok | internal | manual
      // fresh | stale — staleness is honest, not hidden
      freshness: v.optional(
        v.union(v.literal("fresh"), v.literal("stale")),
      ),
      dataAsOf: v.optional(v.number()),
      // new | seen | done — dismissed insights stay visible in history
      status: v.optional(
        v.union(v.literal("new"), v.literal("seen"), v.literal("done")),
      ),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // Website/app builder artifacts (Build module — strategy-first blueprint
    // flow: idea → positioning → blueprint → pages → publish). Every build
    // is grounded in the project's idea, personas and journeys — the same
    // context the Understand/Create modules produce.
    builds: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      kind: v.union(v.literal("website"), v.literal("app")),
      // draft | generated | published
      status: v.union(
        v.literal("draft"),
        v.literal("generated"),
        v.literal("published"),
      ),
      pages: v.optional(v.array(v.string())),
      // strategy layer — what makes this build uniquely competitive
      idea: v.optional(v.string()), // the business idea / app idea being built
      positioning: v.optional(v.string()), // one-line positioning statement
      goals: v.optional(v.array(v.string())), // business goals this build serves
      personaIds: v.optional(v.array(v.id("personas"))), // personas the build speaks to
      journeyMapIds: v.optional(v.array(v.id("journeyMaps"))), // journeys that shape the flow
      differentiators: v.optional(v.array(v.string())), // why we win vs caffeine.ai/lovable/ploy-style tools
      blueprint: v.optional(
        v.object({
          // the AI-generated build plan (regenerated on demand)
          summary: v.optional(v.string()),
          steps: v.optional(
            v.array(
              v.object({
                step: v.string(), // e.g. "positioning", "pages", "content", "seo"
                title: v.string(),
                detail: v.string(),
                // todo | doing | done
                status: v.optional(
                  v.union(v.literal("todo"), v.literal("doing"), v.literal("done")),
                ),
              }),
            ),
          ),
          generatedAt: v.number(),
        }),
      ),
      seoReady: v.optional(v.boolean()),
      wcagReady: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_project", ["projectId"]),

    // One page/screen of a build. Strategy-first: every page declares which
    // persona it speaks to and which journey stage it answers, so the
    // AI-generated draft is grounded, not generic.
    buildPages: defineTable({
      buildId: v.id("builds"),
      projectId: v.id("projects"),
      name: v.string(), // page name / route label, e.g. "Pricing"
      path: v.string(), // e.g. "/pricing"
      goal: v.optional(v.string()), // what this page must achieve
      personaId: v.optional(v.id("personas")),
      journeyStage: v.optional(v.string()),
      draft: v.optional(v.string()), // AI-generated HTML draft
      // pending | drafted | approved
      status: v.optional(
        v.union(v.literal("pending"), v.literal("drafted"), v.literal("approved")),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_build", ["buildId"])
      .index("by_project", ["projectId"]),

    // Files attached to a project (pdfs, figma exports, briefs…) that enrich
    // every downstream module. Bytes live in Convex storage; this is metadata.
    projectFiles: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      mimeType: v.optional(v.string()),
      sizeBytes: v.optional(v.number()),
      storageId: v.id("_storage"),
      // text extracted for AI context (best-effort)
      excerpt: v.optional(v.string()),
      uploadedBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // Journey maps — stages × lanes (actions, thoughts, feelings, pains,
    // opportunities) plus a 0-10 experience score per stage. First-class
    // artifacts in the Understand module; consumed by Create for research.
    journeyMaps: defineTable({
      projectId: v.id("projects"),
      personaId: v.optional(v.id("personas")),
      name: v.string(),
      goal: v.optional(v.string()), // scenario / job-to-be-done
      // Lane labels are customizable; default lanes are added on creation.
      lanes: v.optional(v.array(v.string())),
      stages: v.array(
        v.object({
          stage: v.string(),
          // lane cell contents, parallel to `lanes`
          cells: v.array(v.string()),
          // 0-10 experience score, draws the experience curve
          score: v.optional(v.number()),
        }),
      ),
      source: v.union(
        v.literal("manual"),
        v.literal("ai"),
        v.literal("csv"),
      ),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_project", ["projectId"]),

    // ── Create module: gap analysis → topic research → content writing ────

    // A content gap: missing / weak coverage for one persona at one journey
    // stage. Created by AI analysis of personas + journey maps, or by hand.
    contentGaps: defineTable({
      projectId: v.id("projects"),
      personaId: v.optional(v.id("personas")),
      journeyMapId: v.optional(v.id("journeyMaps")),
      journeyStage: v.optional(v.string()),
      title: v.string(), // short label of the gap
      description: v.optional(v.string()), // what is missing and why it matters
      severity: v.optional(
        v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
      ),
      // open | covered | dismissed — “covered” links the gap to topics/pieces
      status: v.optional(
        v.union(v.literal("open"), v.literal("covered"), v.literal("dismissed")),
      ),
      source: v.optional(v.union(v.literal("ai"), v.literal("manual"))),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_persona", ["projectId", "personaId"]),

    // A researched topic that fills a gap. `research` holds the raw results
    // (provenance-tagged) from the universal research action.
    contentTopics: defineTable({
      projectId: v.id("projects"),
      gapId: v.optional(v.id("contentGaps")),
      title: v.string(),
      angle: v.optional(v.string()), // the angle / hook AI proposes
      // landing_page | script | social_post | social_series | blog | email | video_script
      contentType: v.optional(v.string()),
      keywords: v.optional(v.array(v.string())),
      research: v.optional(
        v.array(
          v.object({
            source: v.string(), // reddit | wikipedia | wikibooks | gdlt | youtube | newsapi | trends | local_news | serp_news | google_books
            title: v.string(),
            url: v.optional(v.string()),
            snippet: v.optional(v.string()),
          }),
        ),
      ),
      researchedAt: v.optional(v.number()),
      status: v.optional(
        v.union(v.literal("idea"), v.literal("researched"), v.literal("in_progress"), v.literal("done")),
      ),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // Collaborative document editor state. BaseYjs updates are stored as a
    // document snapshot; comments/mentions are out of scope for now.
    contentDocs: defineTable({
      pieceId: v.id("contentPieces"),
      snapshot: v.optional(v.bytes()), // latest Yjs update (binary)
      updatedAt: v.number(),
      updatedBy: v.optional(v.id("users")),
    }).index("by_piece", ["pieceId"]),

    // Chat history with a persona (persona mode) or about it (analyst mode)
    personaMessages: defineTable({
      projectId: v.id("projects"),
      personaId: v.id("personas"),
      mode: v.union(v.literal("persona"), v.literal("analyst")),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      createdAt: v.number(),
    })
      .index("by_project_persona", ["projectId", "personaId"])
      .index("by_persona", ["personaId"]),

    // Marketing communications defined with AI. May feed downstream modules
    // (content briefs, campaigns) — optional influence, never forced.
    communications: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      message: v.string(), // the core comms message / positioning statement
      rationale: v.optional(v.string()),
      channels: v.optional(v.array(v.string())),
      audience: v.optional(v.string()),
      // draft | active | archived
      status: v.union(
        v.literal("draft"),
        v.literal("active"),
        v.literal("archived"),
      ),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
