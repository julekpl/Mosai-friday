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
      goals: v.optional(v.array(v.string())),
      kpis: v.optional(v.array(v.string())),
      channels: v.optional(v.array(v.string())),
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
      title: v.string(),
      topic: v.optional(v.string()),
      brief: v.optional(v.string()),
      body: v.optional(v.string()),
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

    // Website/app builder artifacts (Build module — surface now, engine later)
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
      seoReady: v.optional(v.boolean()),
      wcagReady: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
