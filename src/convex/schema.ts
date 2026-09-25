import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import { orgRoleValidator } from "./lib/roles";
import {
  businessTypeValidator,
  customerGroupValidator,
  firstRunNotesValidator,
  postingChannelValidator,
  primaryGoalValidator,
  starterKitPartValidator,
  starterKitStatusValidator,
} from "../shared/starterKit";
import {
  compositionValidator,
  videoAssetKindValidator,
  videoAssetSourceValidator,
  videoJobStatusValidator,
  videoStatusValidator,
} from "./modules/video/validators";

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

export const businessProfileFields = {
  summary: v.string(),
  businessModel: v.union(
    v.literal("b2b"),
    v.literal("b2c"),
    v.literal("b2b2c"),
    v.literal("nonprofit"),
    v.literal("public_sector"),
    v.literal("mixed"),
  ),
  offerings: v.array(v.string()),
  customerSegments: v.array(v.string()),
  notTheAudience: v.array(v.string()),
  customerProblems: v.array(v.string()),
  primaryGoals: v.array(v.string()),
  market: v.optional(v.string()),
  differentiators: v.array(v.string()),
  contentThemes: v.array(v.string()),
};

const hexColor = v.optional(v.string());

// Brand kit (lib/brandProfile.ts): positioning, messaging house, voice and
// visual identity. Bounded and normalised by projects.saveBrandProfile.
export const brandProfileFields = {
  positioning: v.string(),
  category: v.optional(v.string()),
  alternatives: v.array(v.string()),
  promise: v.string(),
  tagline: v.optional(v.string()),
  elevatorPitch: v.optional(v.string()),
  pillars: v.array(
    v.object({
      title: v.string(),
      message: v.string(),
      proofPoints: v.array(v.string()),
    }),
  ),
  personality: v.array(v.string()),
  voice: v.object({
    formality: v.number(),
    humor: v.number(),
    respect: v.number(),
    enthusiasm: v.number(),
  }),
  writeLike: v.array(v.string()),
  neverLike: v.array(v.string()),
  preferredWords: v.array(v.string()),
  avoidWords: v.array(v.string()),
  language: v.optional(v.string()),
  colors: v.object({
    primary: hexColor,
    secondary: hexColor,
    accent: hexColor,
    dark: hexColor,
    light: hexColor,
  }),
  headingFont: v.optional(v.string()),
  bodyFont: v.optional(v.string()),
  imageryStyle: v.array(v.string()),
  shape: v.optional(v.union(v.literal("sharp"), v.literal("soft"), v.literal("round"))),
  logoNotes: v.optional(v.string()),
};

const brandProfileValidator = v.object({
  ...brandProfileFields,
  status: v.union(v.literal("ai_draft"), v.literal("confirmed")),
  updatedAt: v.number(),
  confirmedAt: v.optional(v.number()),
});

const businessProfileValidator = v.object({
  ...businessProfileFields,
  status: v.union(v.literal("ai_draft"), v.literal("confirmed")),
  updatedAt: v.number(),
  confirmedAt: v.optional(v.number()),
});

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

      // MOSAI additions — local billing mirror (source of truth: Stripe; the
      // only writers are the verified webhook + reconciliation server code).
      plan: v.optional(v.string()), // free | starter | growth | scale (registry)
      planStatus: v.optional(
        v.union(
          v.literal("active"),
          v.literal("trialing"),
          v.literal("canceled"),
          v.literal("past_due"),
          // T2.4: the honest wind-down state — a failed payment did not delete
          // anything, it started a wind-down. Never a euphemism for "live".
          v.literal("wind_down"),
        ),
      ),
      stripeCustomerId: v.optional(v.string()),
      deletionRequestedAt: v.optional(v.number()),
      deletionBlockedReason: v.optional(v.string()),
      // Platform operator flag (T2.4 admin). Set by the allow-list resolution
      // in `lib/platformAdmin.ts`; never grantable from the client.
      isPlatformAdmin: v.optional(v.boolean()),
    })
      .index("email", ["email"]) // index for the email. do not remove or modify
      .index("by_deletion_requested", ["deletionRequestedAt"]),

    // No email address or OTP is stored here. A server-keyed digest claims
    // one SMTP attempt per code and keeps only the provider acceptance receipt.
    otpEmailReceipts: defineTable({
      idempotencyKey: v.string(),
      recipientDigest: v.string(),
      status: v.union(
        v.literal("claimed"),
        v.literal("accepted"),
        v.literal("uncertain"),
      ),
      providerMessageId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      expiresAt: v.number(),
    })
      .index("by_idempotency_key", ["idempotencyKey"])
      .index("by_expiry", ["expiresAt"]),

    // ── MOSAI: organizations, memberships, roles and invitations (T2.1) ──
    // Tenancy starts here. Every project belongs to exactly one organization;
    // a user reaches a project through an active membership in its
    // organization. Personal organizations are the default (one per user) and
    // are created by the idempotent migration in `organizations.ts`.

    organizations: defineTable({
      name: v.string(),
      // personal = a solo workspace (exactly one per user); business = a
      // company workspace; agency = a workspace that manages client orgs.
      kind: v.union(
        v.literal("personal"),
        v.literal("business"),
        v.literal("agency"),
      ),
      ownerId: v.id("users"),
      slug: v.optional(v.string()),
      // Set on personal organizations and unique per user: exactly one
      // personal organization per user. `getOrCreatePersonalOrganization`
      // resolves through this index, which is what makes the migration
      // idempotent rather than duplicating workspaces.
      personalFor: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_personal_for", ["personalFor"]),

    memberships: defineTable({
      organizationId: v.id("organizations"),
      userId: v.id("users"),
      role: orgRoleValidator,
      // active = can act; invited = reserved seat before acceptance;
      // suspended = kept for audit but denied access.
      status: v.union(
        v.literal("active"),
        v.literal("invited"),
        v.literal("suspended"),
      ),
      invitedBy: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_user", ["userId"])
      .index("by_organization_user", ["organizationId", "userId"])
      .index("by_organization_status_user", ["organizationId", "status", "userId"])
      .index("by_organization_status_role_user", ["organizationId", "status", "role", "userId"]),

    invitations: defineTable({
      organizationId: v.id("organizations"),
      email: v.string(), // normalized lowercase; the invited identity
      role: orgRoleValidator,
      // Single-use, server-generated. Only ever returned to the inviting
      // owner/admin (there is no email gateway yet — no send is claimed).
      token: v.string(),
      status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("revoked"),
        v.literal("expired"),
      ),
      invitedBy: v.id("users"),
      createdAt: v.number(),
      expiresAt: v.number(),
      acceptedAt: v.optional(v.number()),
      acceptedBy: v.optional(v.id("users")),
    })
      .index("by_organization", ["organizationId"])
      .index("by_email", ["email"])
      .index("by_invited_by", ["invitedBy"])
      .index("by_token", ["token"]),

    // Canonical role registry, seeded idempotently from lib/roles.ts. Code
    // enforces through `roleCan`; this table is the auditable record the UI,
    // export and tests read so a role's capabilities are never a mystery.
    roles: defineTable({
      key: v.string(), // owner | admin | member
      name: v.string(),
      rank: v.number(),
      capabilities: v.array(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // Agency workspaces manage client organizations. A link grants the agency
    // visibility of a client org; it is revoked, never deleted, so the trail
    // survives. See E3.9 for the client-driven consent flow.
    agencyClientLinks: defineTable({
      agencyId: v.id("organizations"), // must be kind === "agency"
      clientId: v.id("organizations"), // personal or business
      status: v.union(v.literal("active"), v.literal("revoked")),
      createdBy: v.id("users"),
      createdAt: v.number(),
      revokedAt: v.optional(v.number()),
    })
      .index("by_agency", ["agencyId"])
      .index("by_client", ["clientId"])
      .index("by_agency_client", ["agencyId", "clientId"]),

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
      // Who the business sells to and what those customers struggle with, as
      // the owner describes it (onboarding step 3 / project settings).
      targetAudience: v.optional(v.array(v.string())),
      customerPains: v.optional(v.array(v.string())),
      serviceArea: v.optional(v.string()),
      // The owner's own marketing problems ("high ad costs"). Kept apart from
      // customerPains so they never become the audience's problems in prompts.
      marketingChallenges: v.optional(v.array(v.string())),
      // First-run answers (docs/ux/first-run-blueprint.md §2, U2): Q1 "What
      // kind of business?" and Q3 "What do you want most right now?". They
      // set defaults (main website button, post topics, plan focus) only.
      businessType: v.optional(businessTypeValidator),
      primaryGoal: v.optional(primaryGoalValidator),
      // Richer first-run answers (U2c): several types and goals can be
      // picked; the first is the main one above, the rest are here. Plus
      // where the owner already posts, who their customers are, and their
      // own words ("Other: ___", "Anything we should know?"), which are data
      // for the AI, never instructions.
      otherBusinessTypes: v.optional(v.array(businessTypeValidator)),
      otherGoals: v.optional(v.array(primaryGoalValidator)),
      postingChannels: v.optional(v.array(postingChannelValidator)),
      customerGroups: v.optional(v.array(customerGroupValidator)),
      firstRunNotes: v.optional(firstRunNotesValidator),
      // The project's chosen AI model (one of the operator-enabled aiModels).
      aiModelId: v.optional(v.string()),
      // The reviewed "what this business is" statement every AI prompt is
      // grounded in (lib/businessProfile.ts). Drafted by AI on the server,
      // confirmed by the owner in project settings.
      businessProfile: v.optional(businessProfileValidator),
      // The brand kit every AI feature writes and designs with
      // (lib/brandProfile.ts). Same ai_draft -> confirmed lifecycle.
      brandProfile: v.optional(brandProfileValidator),
      // Where the brand kit and active marketing messages are applied
      // (lib/brandProfile.ts BRAND_USES). Missing keys use DEFAULT_BRAND_USE.
      brandUse: v.optional(
        v.object({
          content: v.optional(v.boolean()),
          social: v.optional(v.boolean()),
          website: v.optional(v.boolean()),
          shop: v.optional(v.boolean()),
          research: v.optional(v.boolean()),
        }),
      ),
      // The organization this project belongs to (T2.1). Optional only so the
      // migration can backfill pre-organization projects; every project
      // created after T2.1 is written with its owner's personal organization.
      organizationId: v.optional(v.id("organizations")),
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
          pages: v.optional(v.array(v.object({
            url: v.string(),
            title: v.optional(v.string()),
            description: v.optional(v.string()),
            headings: v.array(v.string()),
            productsServices: v.array(v.string()),
            excerpt: v.string(),
          }))),
          socialChannels: v.optional(v.array(v.string())),
          // Public image addresses found on the owner's own pages (U5), so the
          // starter kit can use their photos before any stock picture. Data
          // only: imported later by id through safeFetch, never hotlinked.
          images: v.optional(
            v.array(v.object({ url: v.string(), alt: v.optional(v.string()), pageUrl: v.optional(v.string()) })),
          ),
          businessDetails: v.optional(v.object({
            name: v.optional(v.string()),
            address: v.optional(v.string()),
            country: v.optional(v.string()),
            phone: v.optional(v.string()),
            email: v.optional(v.string()),
            footerExcerpt: v.optional(v.string()),
          })),
          coverage: v.optional(v.object({
            sitemapCount: v.number(),
            sitemapFailureCount: v.number(),
            discoveredPageCount: v.number(),
            scannedPageCount: v.number(),
            failedPageCount: v.number(),
            skippedByRobotsCount: v.number(),
            pageLimit: v.number(),
            truncated: v.boolean(),
          })),
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
      .index("by_owner_name", ["ownerId", "name"])
      .index("by_organization", ["organizationId"]),

    personas: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      role: v.optional(v.string()),
      goals: v.optional(v.array(v.string())),
      pains: v.optional(v.array(v.string())),
      objections: v.optional(v.array(v.string())),
      channels: v.optional(v.array(v.string())),
      country: v.optional(v.string()),
      demographics: v.optional(v.string()),
      culturalContext: v.optional(v.string()),
      bigFive: v.optional(v.object({
        openness: v.number(),
        conscientiousness: v.number(),
        extraversion: v.number(),
        agreeableness: v.number(),
        neuroticism: v.number(),
      })),
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
      // Lifecycle is explicit: only a verified provider flow may set
      // "connected". Generic connection intents must never claim success.
      status: v.union(
        v.literal("available"),
        v.literal("authorizing"),
        v.literal("connected"),
        v.literal("syncing"),
        v.literal("needs_attention"),
        v.literal("disconnected"),
        v.literal("unsupported"),
      ),
      authorizationStartedAt: v.optional(v.number()),
      accountLabel: v.optional(v.string()),
      providerAccountId: v.optional(v.string()),
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
      // Who owns this row's lifecycle (BP-03): "local" means MOSAI tracks it
      // and the client may move it; "provider" means the provider campaign is
      // authoritative and only server code (ads control/receipts) may move it.
      trackingSource: v.optional(v.union(v.literal("local"), v.literal("provider"))),
      // Provider-side reference when provider-tracked (safe id, never a token).
      providerRef: v.optional(v.string()),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    posts: defineTable({
      projectId: v.id("projects"),
      contentId: v.optional(v.id("contentPieces")),
      campaignId: v.optional(v.id("campaigns")),
      channel: v.string(), // facebook | instagram | linkedin | x | tiktok
      body: v.string(),
      mediaUrl: v.optional(v.string()), // public https URL to an image / video
      scheduledFor: v.optional(v.number()),
      // draft | scheduled | published | failed
      status: v.union(
        v.literal("draft"),
        v.literal("scheduled"),
        v.literal("published"),
        v.literal("failed"),
      ),
      // who drafted it — AI drafts are never auto-published (copilot | user)
      origin: v.optional(v.union(v.literal("user"), v.literal("copilot"))),
      // publish receipt: provider-side reference + error detail + timestamp
      providerRef: v.optional(v.string()),
      errorDetail: v.optional(v.string()),
      publishedAt: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_status", ["projectId", "status"])
      .index("by_status", ["status"]),

    // OAuth tokens for social publishing platforms (Promote module). Mirrors
    // adsCredentials: tokens live server-side only, never sent to the client.
    socialCredentials: defineTable({
      projectId: v.id("projects"),
      platform: v.string(), // facebook | instagram | linkedin | x | tiktok
      accessToken: v.string(),
      refreshToken: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      scope: v.optional(v.string()),
      // provider-side account to post as (page id, open_id, …)
      providerAccountId: v.optional(v.string()),
      accountLabel: v.optional(v.string()),
      // BP-04 — refresh bookkeeping, written only by internal server
      // functions (the refresh action + its claim/save mutations). The client
      // never receives tokens; `refreshStatus` is the safe, UI-facing signal.
      refreshStatus: v.optional(
        v.union(v.literal("ok"), v.literal("needs_reconnect")),
      ),
      tokenVersion: v.optional(v.number()),
      refreshLeaseId: v.optional(v.string()),
      refreshLeaseUntil: v.optional(v.number()),
      connectedBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_platform", ["projectId", "platform"]),

    // ── Sell module (M1 Commerce Brain) — see M1-BLUEPRINT.md ────────────

    products: defineTable({
      projectId: v.id("projects"),
      // identity & lifecycle
      title: v.string(),
      slug: v.optional(v.string()),
      description: v.optional(v.string()),
      // draft | active | archived
      status: v.optional(
        v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
      ),
      // source authority (SELL-ARCHITECTURE §3 — present from day one so M2
      // connectors never need a migration). M1 always writes mosai_native.
      source: v.optional(
        v.union(v.literal("mosai_native"), v.literal("external")),
      ),
      authority: v.optional(v.string()), // "mosai" | provider key
      provider: v.optional(v.string()),
      externalId: v.optional(v.string()),
      syncState: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
      // merchandising facts
      brand: v.optional(v.string()),
      productType: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      collectionIds: v.optional(v.array(v.id("collections"))),
      // provider-native route for external-checkout handoff (§57, §91) —
      // e.g. Shopify product URL; never a copied commerce fact
      externalUrl: v.optional(v.string()),
      // MOSAI enrichment — conceptually separate from commerce facts.
      // origin records who produced the enrichment (auditability).
      enrichment: v.optional(
        v.object({
          seoTitle: v.optional(v.string()),
          seoDescription: v.optional(v.string()),
          buyerObjections: v.optional(v.array(v.string())),
          contentOpportunities: v.optional(v.array(v.string())),
          origin: v.optional(v.union(v.literal("ai"), v.literal("user"))),
          updatedAt: v.optional(v.number()),
        }),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_status", ["projectId", "status"]),

    // Every Product has ≥1 variant (default variant hidden in ordinary UX).
    // Variants own the purchasable facts: price, sku/gtin, availability.
    productVariants: defineTable({
      projectId: v.id("projects"),
      productId: v.id("products"),
      isDefault: v.boolean(), // exactly one per product, enforced in mutations
      title: v.optional(v.string()), // explicit variants only, e.g. "Black / S"
      sku: v.optional(v.string()),
      gtin: v.optional(v.string()),
      // has_identifiers | no_identifiers_exist | unknown — honest identifier
      // model; GTIN missing is never an error (identifier_exists=no exists)
      identifierStatus: v.optional(v.string()),
      priceCents: v.optional(v.number()),
      compareAtPriceCents: v.optional(v.number()),
      currency: v.string(),
      inventoryCount: v.optional(v.number()), // null = not tracked
      // in_stock | out_of_stock | backorder | preorder — never remapped;
      // preorder/backorder require availabilityDate for feeds
      availability: v.optional(v.string()),
      availabilityDate: v.optional(v.number()),
      optionValues: v.optional(
        v.array(v.object({ name: v.string(), value: v.string() })),
      ),
      source: v.optional(
        v.union(v.literal("mosai_native"), v.literal("external")),
      ),
      externalId: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_product", ["productId"])
      .index("by_project", ["projectId"]),

    // media[] model even though M1 UX exposes one image field
    productMedia: defineTable({
      projectId: v.id("projects"),
      productId: v.id("products"),
      variantId: v.optional(v.id("productVariants")),
      url: v.string(),
      alt: v.optional(v.string()),
      position: v.optional(v.number()), // 0 = primary
      source: v.optional(
        v.union(v.literal("mosai_native"), v.literal("external")),
      ),
      createdAt: v.number(),
    }).index("by_product", ["productId"]),

    // Collections reference products; they never own product data
    // External identity fields (W5 connector contract): provider-owned rows
    // are marked source/authority/provider/externalId — synced, never copied.
    collections: defineTable({
      projectId: v.id("projects"),
      title: v.string(),
      description: v.optional(v.string()),
      slug: v.optional(v.string()),
      source: v.optional(
        v.union(v.literal("mosai_native"), v.literal("external")),
      ),
      authority: v.optional(v.string()), // "mosai" | provider key
      provider: v.optional(v.string()),
      externalId: v.optional(v.string()),
      lastSyncedAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // Lightweight analytics for the pre-registered M1 decision-gate signals
    // (SELL-EXECUTION-PLAN). One row per signal; no PII, no provider data.
    commerceEvents: defineTable({
      projectId: v.id("projects"),
      event: v.string(),
      // free-form dimension bag (productId, checkId, surface, counts…)
      meta: v.optional(v.any()),
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
      // BP-15: an app has its own reviewed requirements, separate from CMS
      // pages and website release state. Source labels are server-derived
      // snapshots of authorized project records, not client claims of proof.
      appRequirements: v.optional(
        v.object({
          version: v.literal(1),
          state: v.union(v.literal("draft"), v.literal("reviewed")),
          audience: v.union(
            v.literal("customer_facing"),
            v.literal("internal_team"),
            v.literal("both"),
          ),
          goal: v.string(),
          targetUsers: v.string(),
          coreWorkflows: v.array(v.string()),
          constraints: v.array(v.string()),
          sourceRefs: v.array(
            v.union(
              v.object({ kind: v.literal("persona"), id: v.id("personas"), label: v.string(), sourceVersion: v.string() }),
              v.object({ kind: v.literal("journeyMap"), id: v.id("journeyMaps"), label: v.string(), sourceVersion: v.string() }),
              v.object({ kind: v.literal("contentPiece"), id: v.id("contentPieces"), label: v.string(), sourceVersion: v.string() }),
            ),
          ),
          editedAt: v.number(),
          reviewedAt: v.optional(v.number()),
          reviewedBy: v.optional(v.id("users")),
        }),
      ),
      seoReady: v.optional(v.boolean()),
      wcagReady: v.optional(v.boolean()),
      // BP-03 local release lifecycle — never an external claim. `prepared`
      // means a release audit exists and pinned revisions are approved;
      // `verified` is reserved for BP-13's deployment receipt.
      releaseState: v.optional(
        v.union(
          v.literal("none"),
          v.literal("prepared"),
          v.literal("failed"),
          v.literal("verified"),
        ),
      ),
      lastReleaseAuditId: v.optional(v.id("buildReleaseAudits")),
      lastReleaseAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_project", ["projectId"])
      // One website and one app per project (owner decision, 24 Sep 2026):
      // `builds.create` reads this index before inserting.
      .index("by_project_kind", ["projectId", "kind"]),

    // Server-written release-preparation audit trail (BP-03). One row per
    // accepted `publishSite` preparation: which draft revisions were
    // promoted, under which readiness rules, and (later, via BP-13) which
    // deployment confirmed them externally. Client code has no writer for
    // this table — only internal mutations do.
    buildReleaseAudits: defineTable({
      projectId: v.id("projects"),
      buildId: v.id("builds"),
      siteId: v.id("sites"),
      // draft_approved | release_prepared | deploying | verified | failed
      phase: v.union(
        v.literal("draft_approved"),
        v.literal("release_prepared"),
        v.literal("deploying"),
        v.literal("verified"),
        v.literal("failed"),
      ),
      // revision ids this release pins (per page, at preparation time)
      revisionIds: v.array(v.id("pageRevisions")),
      // pages whose draft could not be promoted, with a safe reason
      skipped: v.array(
        v.object({ title: v.string(), reason: v.string() }),
      ),
      // the page revision versions audited, for readability in the UI
      revisionVersions: v.optional(v.array(v.number())),
      // readiness rules applied (src/shared/contracts/status.ts)
      ruleVersion: v.number(),
      // pages whose checks failed at preparation time (blocking)
      pagesWithBlocking: v.optional(v.array(v.id("cmsPages"))),
      // BP-03 review follow-up 3: the ROUTE map this release serves —
      // fullPath → pinned revision id, plus the page metadata frozen at
      // preparation (follow-up 4: title/SEO are mutable page fields; the
      // confirmed release must serve its own metadata, not whatever a
      // later unverified edit left on the live row). A content pin alone is
      // insufficient: the public readers must resolve paths through this
      // map, not the mutable by_site_path index.
      routes: v.optional(
        v.array(
          v.object({
            fullPath: v.string(),
            revisionId: v.id("pageRevisions"),
            // metadata snapshot at preparation time
            // Optional for compatibility with route snapshots written before
            // title/SEO were added. Public delivery fails closed when absent.
            title: v.optional(v.string()),
            seo: v.optional(
              v.object({
                title: v.optional(v.string()),
                metaDescription: v.optional(v.string()),
                noindex: v.optional(v.boolean()),
                ogImageUrl: v.optional(v.string()),
              }),
            ),
          }),
        ),
      ),
      // redirects this release serves (snapshot at preparation time);
      // honored externally only once this release is verified.
      redirects: v.optional(
        v.array(
          v.object({
            fromPath: v.string(),
            to: v.string(),
            statusCode: v.union(v.literal(301), v.literal(302)),
          }),
        ),
      ),
      // BP-03 readiness pins: the exact draft content each page was checked
      // at. Readiness is verified by pin equality (revision id AND content),
      // so an in-place content edit invalidates it immediately.
      pins: v.optional(
        v.array(
          v.object({
            pageId: v.id("cmsPages"),
            revisionId: v.id("pageRevisions"),
            documentJson: v.string(),
          }),
        ),
      ),
      // reserved for BP-13: the deployment that verified this release
      deploymentId: v.optional(v.id("buildDeployments")),
      // stable operation key so retries of one logical preparation are safe
      operationKey: v.optional(v.string()),
      // user who triggered the preparation; absent for system audits
      createdBy: v.optional(v.id("users")),
      createdAt: v.number(),
    })
      .index("by_build", ["buildId"])
      .index("by_project", ["projectId"])
      .index("by_site", ["siteId"]),

    // BP-13 placeholder: referenced by buildReleaseAudits.deploymentId so
    // the receipt chain has a home before the deployment adapter lands. No
    // code writes it yet; the verifier (§4.2 protocol) will.
    buildDeployments: defineTable({
      projectId: v.id("projects"),
      buildId: v.id("builds"),
      siteId: v.id("sites"),
      releaseAuditId: v.optional(v.id("buildReleaseAudits")),
      // queued | running | succeeded | failed | canceled
      state: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("failed"),
        v.literal("canceled"),
      ),
      provider: v.optional(v.string()),
      providerResourceId: v.optional(v.string()),
      // Set only by a future host verifier after domain ownership proof.
      // Public projection resolves through this receipt field, never a
      // caller-supplied site/project id.
      publicHostname: v.optional(v.string()),
      // Safe, user-facing failure reason (no provider secrets or env values).
      error: v.optional(v.string()),
      finishedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_build", ["buildId"])
      .index("by_project", ["projectId"])
      .index("by_public_hostname", ["publicHostname"])
      // Idempotency: one logical deployment per release audit (siteHosting).
      .index("by_release_audit", ["releaseAuditId"]),

    // MOSAI-hosted public site addresses (owner decision, 24 Sep 2026):
    // `/s/<slug>-website`. Allocated once on the first deploy from the
    // project name and stable afterwards (a rename never moves the URL).
    // Written only by siteHosting's internal mutations.
    publicSites: defineTable({
      projectId: v.id("projects"),
      kind: v.union(v.literal("website"), v.literal("app")),
      slug: v.string(),
      createdAt: v.number(),
    })
      .index("by_slug", ["slug"])
      .index("by_project_kind", ["projectId", "kind"])
      .index("by_project", ["projectId"]),

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

    // ── Build workspace (Lovable/Caffeine-style chat builder) ────────────
    // Chat history per build. Plan-mode messages shape strategy; build-mode
    // messages produce PageDocument edits. AI never publishes (§174.12).
    buildMessages: defineTable({
      buildId: v.id("builds"),
      projectId: v.id("projects"),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      // plan | build — which editor mode produced/consumed this message
      mode: v.optional(v.union(v.literal("plan"), v.literal("build"))),
      // optional structured suggestions attached to an assistant reply
      suggestions: v.optional(
        v.array(
          v.object({
            name: v.string(),
            goal: v.optional(v.string()),
          }),
        ),
      ),
      // pages touched by a build-mode edit (labels only, for the chat chip)
      changedPaths: v.optional(v.array(v.string())),
      createdAt: v.number(),
    }).index("by_build", ["buildId"]),

    // Version history (Lovable "versions"): immutable snapshots of every
    // page document at a point in time. Publish marks the published version;
    // restore copies a snapshot back into fresh draft revisions.
    buildVersions: defineTable({
      buildId: v.id("builds"),
      projectId: v.id("projects"),
      version: v.number(), // monotonically increasing per build
      label: v.string(), // short human label (prompt snippet)
      summary: v.optional(v.string()),
      pages: v.array(
        v.object({
          pageId: v.id("cmsPages"),
          title: v.string(),
          slug: v.string(),
          fullPath: v.string(),
          // the page HTML draft at snapshot time — restored verbatim
          draft: v.string(),
        }),
      ),
      isPublished: v.optional(v.boolean()),
      createdAt: v.number(),
    }).index("by_build", ["buildId"]),

    // BP-15 app builder. An app is versioned source, never a CMS document.
    // One chat turn = one run (a job, AGENTS.md rule 13). Each run that
    // changes code writes an immutable snapshot; file bodies are stored once
    // per build by SHA-256 so snapshots stay small. Generated code is data:
    // it only executes in the preview iframe on the bundler's own origin.
    appRuns: defineTable({
      buildId: v.id("builds"),
      projectId: v.id("projects"),
      userId: v.id("users"),
      prompt: v.string(),
      mode: v.union(v.literal("create"), v.literal("edit")),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("partially_succeeded"),
        v.literal("failed"),
        v.literal("canceled"),
      ),
      baseVersion: v.optional(v.number()),
      snapshotVersion: v.optional(v.number()),
      reply: v.optional(v.string()),
      changedPaths: v.optional(v.array(v.string())),
      skippedPaths: v.optional(v.array(v.string())),
      error: v.optional(v.string()),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
    })
      .index("by_build", ["buildId", "createdAt"])
      .index("by_project", ["projectId"]),

    appSnapshots: defineTable({
      buildId: v.id("builds"),
      projectId: v.id("projects"),
      version: v.number(),
      label: v.string(),
      source: v.union(v.literal("starter"), v.literal("ai"), v.literal("manual"), v.literal("restore")),
      runId: v.optional(v.id("appRuns")),
      files: v.array(v.object({ path: v.string(), hash: v.string(), bytes: v.number() })),
      dependencies: v.array(v.object({ name: v.string(), version: v.string() })),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_build", ["buildId", "version"])
      .index("by_project", ["projectId"]),

    appSourceFiles: defineTable({
      buildId: v.id("builds"),
      projectId: v.id("projects"),
      hash: v.string(),
      content: v.string(),
      createdAt: v.number(),
    })
      .index("by_build", ["buildId", "hash"])
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
      // Where the file came from (U5). Missing means an owner upload.
      source: v.optional(v.union(v.literal("upload"), v.literal("owner_site"), v.literal("stock"))),
      // Stock credit, stored per asset as the Pexels guidelines require
      // (CREATE-VIDEO-BLUEPRINT D6); shown where results are shown.
      attribution: v.optional(
        v.object({
          provider: v.literal("pexels"),
          externalId: v.string(),
          photographer: v.string(),
          photographerUrl: v.string(),
          pageUrl: v.string(),
        }),
      ),
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
    // Create → Video (E3.11). A video's composition is the single source of
    // truth for the editor preview and the browser export
    // (src/shared/video/composition.ts). `revision` gives optimistic
    // concurrency to `videos.save`.
    videos: defineTable({
      projectId: v.id("projects"),
      pieceId: v.optional(v.id("contentPieces")),
      title: v.string(),
      composition: compositionValidator,
      fingerprint: v.string(),
      revision: v.number(),
      status: videoStatusValidator,
      storyboardStatus: v.optional(videoJobStatusValidator),
      storyboardError: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_piece", ["pieceId"]),

    // Media a video uses (uploads, stock) and the files it produced (browser
    // exports). Provenance is required. Blobs are deleted with the row.
    videoAssets: defineTable({
      projectId: v.id("projects"),
      videoId: v.id("videos"),
      kind: videoAssetKindValidator,
      storageId: v.id("_storage"),
      mimeType: v.string(),
      sizeBytes: v.number(),
      name: v.optional(v.string()),
      width: v.optional(v.number()),
      height: v.optional(v.number()),
      durationMs: v.optional(v.number()),
      source: videoAssetSourceValidator,
      // Exports only: which composition and renderer produced the file, as
      // reported by the browser. Recorded, not verified (blueprint §10).
      fingerprint: v.optional(v.string()),
      rendererVersion: v.optional(v.string()),
      codec: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_video", ["videoId"]),

    // Source library for one content piece: the full text the writer (and
    // the AI) works from. Rows come from uploaded files (text extracted on the
    // server, the blob is then deleted), imported web pages, YouTube
    // transcripts, saved research findings and pasted notes. `text` is the
    // capped full text; generation retrieves from it (lib/sourceText.ts).
    // Source text is data, never instructions.
    contentSources: defineTable({
      projectId: v.id("projects"),
      pieceId: v.id("contentPieces"),
      kind: v.union(
        v.literal("file"),
        v.literal("web"),
        v.literal("youtube"),
        v.literal("research"),
        v.literal("note"),
      ),
      title: v.string(),
      url: v.optional(v.string()),
      // research provider (reddit, wikipedia, …) or file mime type
      provider: v.optional(v.string()),
      fileName: v.optional(v.string()),
      text: v.string(),
      charCount: v.number(),
      // true when the original was longer than the stored cap
      truncated: v.boolean(),
      // how the text was obtained, shown to the user as-is
      extraction: v.string(),
      // include this source when AI drafts or edits
      included: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_piece", ["pieceId"]),

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
      // Creative-brief fields (optional; older rows have none): the facts
      // that make the message believable, what the audience should think,
      // feel and do, the call to action, and the brand key message it
      // supports (by title, from brandProfile.pillars).
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
      // draft | active | archived
      status: v.union(
        v.literal("draft"),
        v.literal("active"),
        v.literal("archived"),
      ),
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // ── Ads module: platform connections, campaigns, metrics, change control ──

    // OAuth access + refresh tokens per (project, platform). Tokens are stored
    // server-side only; the client never sees them. accessTokens expire and are
    // refreshed by the sync/execute actions.
    adsCredentials: defineTable({
      projectId: v.id("projects"),
      platform: v.string(), // google | meta | tiktok | chatgpt
      accessToken: v.string(),
      refreshToken: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      scope: v.optional(v.string()),
      accountLabel: v.optional(v.string()),
      // BP-04 — refresh bookkeeping, written only by internal server
      // functions (the refresh action + its claim/save mutations). The client
      // never receives tokens; `refreshStatus` is the safe, UI-facing signal.
      refreshStatus: v.optional(
        v.union(v.literal("ok"), v.literal("needs_reconnect")),
      ),
      tokenVersion: v.optional(v.number()),
      refreshLeaseId: v.optional(v.string()),
      refreshLeaseUntil: v.optional(v.number()),
      connectedBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_platform", ["projectId", "platform"]),

    // Short-lived CSRF state for the OAuth redirect round-trip.
    oauthStates: defineTable({
      state: v.string(),
      projectId: v.id("projects"),
      platform: v.string(),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_state", ["state"])
      .index("by_user", ["createdBy"]),

    // ── Grow: one Google connection per project (GA4, Search Console, Ads) ──

    // OAuth tokens + the resources the signed-in Google account can reach.
    // Tokens are server-only: public queries project explicit safe fields.
    // `status` is written only by the OAuth callback / refresh bookkeeping.
    googleConnections: defineTable({
      projectId: v.id("projects"),
      accessToken: v.string(),
      refreshToken: v.optional(v.string()),
      expiresAt: v.optional(v.number()),
      scope: v.optional(v.string()),
      accountEmail: v.optional(v.string()),
      status: v.union(v.literal("connected"), v.literal("needs_reconnect")),
      tokenVersion: v.optional(v.number()),
      refreshLeaseId: v.optional(v.string()),
      refreshLeaseUntil: v.optional(v.number()),
      connectedBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
      // Resource lists from the last successful listing (bounded).
      resourcesListedAt: v.optional(v.number()),
      ga4Properties: v.optional(
        v.array(v.object({ id: v.string(), name: v.string(), account: v.optional(v.string()) })),
      ),
      gscSites: v.optional(
        v.array(v.object({ siteUrl: v.string(), permission: v.optional(v.string()) })),
      ),
      adsCustomers: v.optional(
        v.array(
          v.object({
            id: v.string(),
            name: v.optional(v.string()),
            currency: v.optional(v.string()),
            manager: v.optional(v.boolean()),
            usable: v.boolean(),
          }),
        ),
      ),
      resourceErrors: v.optional(
        v.array(
          v.object({
            source: v.union(v.literal("ga4"), v.literal("gsc"), v.literal("gads")),
            state: v.union(v.literal("needs_setup"), v.literal("error")),
            code: v.optional(v.string()),
            message: v.string(),
          }),
        ),
      ),
      // What the owner picked. Validated against the listed resources.
      ga4PropertyId: v.optional(v.string()),
      ga4PropertyName: v.optional(v.string()),
      gscSiteUrl: v.optional(v.string()),
      adsCustomerId: v.optional(v.string()),
      adsCustomerName: v.optional(v.string()),
    }).index("by_project", ["projectId"]),

    // The first-run starter kit (docs/ux/first-run-blueprint.md §4, U3): one
    // job per project that drafts a plan, a website and a week of posts.
    // Standard job states (AGENTS.md rule 13) with a status per part, so one
    // part can fail alone and "Try again" resumes only the failed parts.
    // Nothing the kit writes is published, scheduled or sent (rule 5).
    starterKits: defineTable({
      projectId: v.id("projects"),
      organizationId: v.optional(v.id("organizations")),
      requestedBy: v.id("users"),
      // One kit per project: the key is the project id.
      idempotencyKey: v.string(),
      status: starterKitStatusValidator,
      parts: v.object({
        plan: starterKitPartValidator,
        site: starterKitPartValidator,
        posts: starterKitPartValidator,
      }),
      attempts: v.number(),
      // Hard AI cost cap for the whole kit, in integer micro-USD (rule 7),
      // and what the kit's aiRuns have spent so far.
      budgetMicrousd: v.number(),
      spentMicrousd: v.number(),
      budgetCurrency: v.literal("USD"),
      // The owner closed the kit cards on Home.
      dismissedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
    })
      .index("by_project", ["projectId"])
      .index("by_idempotency", ["idempotencyKey"]),

    // Shared stock search cache (CREATE-VIDEO-BLUEPRINT V4, U5). Protects the
    // app-wide Pexels quota (200/h, 20k/month). No user data: the normalized
    // query, result ids, thumbnails and credit. Expired rows are swept.
    stockSearchCache: defineTable({
      key: v.string(), // provider:orientation:normalized query
      results: v.array(
        v.object({
          provider: v.literal("pexels"),
          externalId: v.string(),
          width: v.number(),
          height: v.number(),
          alt: v.optional(v.string()),
          thumbUrl: v.string(),
          photographer: v.string(),
          photographerUrl: v.string(),
          pageUrl: v.string(),
        }),
      ),
      fetchedAt: v.number(),
      expiresAt: v.number(),
    })
      .index("by_key", ["key"])
      .index("by_expires", ["expiresAt"]),

    // When each member last looked at a project's Home (U7 "Since you were
    // away"). One row per user and project; the summary counts only rows
    // created after `lastSeenAt`. No content, just two timestamps.
    projectVisits: defineTable({
      projectId: v.id("projects"),
      userId: v.id("users"),
      lastSeenAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user_project", ["userId", "projectId"])
      .index("by_project", ["projectId"])
      .index("by_user", ["userId"]),

    // One sync job (AGENTS.md rule 13 states). Each source records its own
    // outcome; errors are plain-language plus an enum-like provider code.
    googleSyncRuns: defineTable({
      projectId: v.id("projects"),
      trigger: v.union(v.literal("manual"), v.literal("cron"), v.literal("connect")),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("succeeded"),
        v.literal("partially_succeeded"),
        v.literal("failed"),
        v.literal("canceled"),
      ),
      idempotencyKey: v.string(),
      requestedBy: v.optional(v.id("users")),
      createdAt: v.number(),
      startedAt: v.optional(v.number()),
      finishedAt: v.optional(v.number()),
      sources: v.array(
        v.object({
          source: v.union(v.literal("ga4"), v.literal("gsc"), v.literal("gads")),
          status: v.union(v.literal("succeeded"), v.literal("failed"), v.literal("skipped")),
          rows: v.number(),
          code: v.optional(v.string()),
          message: v.optional(v.string()),
        }),
      ),
      message: v.optional(v.string()),
    })
      .index("by_project", ["projectId"])
      .index("by_project_created", ["projectId", "createdAt"])
      .index("by_idempotency", ["idempotencyKey"]),

    // Daily totals per source (56 days: the last 28 plus the 28 before).
    // Money is integer micros of `currency`.
    googleMetricsDaily: defineTable({
      projectId: v.id("projects"),
      source: v.union(v.literal("ga4"), v.literal("gsc"), v.literal("gads")),
      resourceId: v.string(),
      date: v.string(), // YYYY-MM-DD in the provider's reporting timezone
      sessions: v.optional(v.number()),
      users: v.optional(v.number()),
      keyEvents: v.optional(v.number()),
      engagementRate: v.optional(v.number()),
      clicks: v.optional(v.number()),
      impressions: v.optional(v.number()),
      ctr: v.optional(v.number()),
      position: v.optional(v.number()),
      costMicros: v.optional(v.number()),
      conversions: v.optional(v.number()),
      currency: v.optional(v.string()),
      syncedAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_source_date", ["projectId", "source", "date"]),

    // Period totals (first run is the headline pair: current vs previous 28
    // days) and bounded top lists (queries, pages, landing pages, channels,
    // campaigns) for the last 28 days.
    googleTopItems: defineTable({
      projectId: v.id("projects"),
      source: v.union(v.literal("ga4"), v.literal("gsc"), v.literal("gads")),
      kind: v.union(
        v.literal("totals_current"),
        v.literal("totals_previous"),
        v.literal("query"),
        v.literal("page"),
        v.literal("landing_page"),
        v.literal("channel"),
        v.literal("campaign"),
      ),
      rank: v.number(),
      label: v.string(),
      key: v.optional(v.string()),
      status: v.optional(v.string()),
      sessions: v.optional(v.number()),
      users: v.optional(v.number()),
      keyEvents: v.optional(v.number()),
      engagementRate: v.optional(v.number()),
      clicks: v.optional(v.number()),
      impressions: v.optional(v.number()),
      ctr: v.optional(v.number()),
      position: v.optional(v.number()),
      costMicros: v.optional(v.number()),
      conversions: v.optional(v.number()),
      currency: v.optional(v.string()),
      periodStart: v.string(),
      periodEnd: v.string(),
      syncedAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_source", ["projectId", "source"]),

    // Ad accounts discovered for each connected platform.
    adsAccounts: defineTable({
      projectId: v.id("projects"),
      platform: v.string(),
      accountId: v.string(), // provider-side id (customer_id / ad_account_id…)
      name: v.string(),
      currency: v.optional(v.string()),
      // selected | not_selected — which accounts are imported
      status: v.union(v.literal("selected"), v.literal("not_selected")),
      lastSyncedAt: v.optional(v.number()),
    })
      .index("by_project", ["projectId"])
      .index("by_project_platform", ["projectId", "platform"]),

    // Normalized campaigns imported from the providers.
    adsCampaigns: defineTable({
      projectId: v.id("projects"),
      platform: v.string(),
      accountId: v.string(),
      campaignId: v.string(),
      name: v.string(),
      status: v.string(), // normalized: ACTIVE | PAUSED | REMOVED | ARCHIVED | UNKNOWN
      objective: v.optional(v.string()),
      // daily + lifetime budget, always in the account's minor units (cents)
      dailyBudgetCents: v.optional(v.number()),
      lifetimeBudgetCents: v.optional(v.number()),
      lastSyncedAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_project_platform", ["projectId", "platform"])
      .index("by_platform_campaign", ["projectId", "platform", "campaignId"]),

    // Aggregated performance per (campaign, day). Source + freshness are part
    // of the product — numbers never silently blended across platforms.
    adsMetrics: defineTable({
      projectId: v.id("projects"),
      platform: v.string(),
      campaignId: v.string(),
      date: v.string(), // YYYY-MM-DD in the account's reporting timezone
      spendCents: v.number(),
      impressions: v.number(),
      clicks: v.number(),
      conversions: v.number(),
      updatedAt: v.number(),
    })
      .index("by_campaign_day", ["projectId", "platform", "campaignId", "date"])
      .index("by_project", ["projectId"]),

    // A proposed external change. Everything the AI or a user wants to do to a
    // live platform lands here first — nothing executes without approval.
    adsChangeRequests: defineTable({
      projectId: v.id("projects"),
      platform: v.string(),
      accountId: v.string(),
      campaignId: v.string(),
      campaignName: v.string(),
      // pause | resume | set_daily_budget
      kind: v.union(
        v.literal("pause"),
        v.literal("resume"),
        v.literal("set_daily_budget"),
      ),
      // the numeric payload (budget minor units for set_daily_budget)
      payload: v.optional(v.number()),
      beforeValue: v.optional(v.number()),
      rationale: v.optional(v.string()),
      // the surface that produced this draft: user | copilot
      origin: v.union(v.literal("user"), v.literal("copilot")),
      // draft | approved | executed | rejected | failed
      status: v.union(
        v.literal("draft"),
        v.literal("approved"),
        v.literal("executing"),
        v.literal("executed"),
        v.literal("rejected"),
        v.literal("failed"),
      ),
      idempotencyKey: v.optional(v.string()),
      // Server-only execution claim. A receipt may be recorded only by the
      // worker holding this token; an ambiguous abandoned claim needs review.
      executionToken: v.optional(v.string()),
      requestedBy: v.id("users"),
      createdAt: v.number(),
      decidedAt: v.optional(v.number()),
    })
      .index("by_project", ["projectId"])
      .index("by_project_status", ["projectId", "status"]),

    // Immutable execution receipts for approved changes.
    adsExecutions: defineTable({
      projectId: v.id("projects"),
      changeId: v.id("adsChangeRequests"),
      platform: v.string(),
      campaignId: v.string(),
      kind: v.string(),
      result: v.string(), // success | error
      providerRef: v.optional(v.string()),
      errorDetail: v.optional(v.string()),
      executedBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_project", ["projectId"])
      .index("by_change", ["changeId"]),

    // Copilot chat history (per project). AI calls go through OpenRouter with
    // the admin-selected model; tokens never leave the server.
    adsCopilotMessages: defineTable({
      projectId: v.id("projects"),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      // when the assistant suggested a change, the created draft id lands here
      changeRequestId: v.optional(v.id("adsChangeRequests")),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // App-wide admin settings (single row). Holds the OpenRouter model the
    // admin selected for the Ads Copilot.
    appSettings: defineTable({
      key: v.string(),
      copilotModel: v.optional(v.string()),
      updatedAt: v.number(),
    }).index("by_key", ["key"]),

    // Platform operators (T2.4). A revoked row is kept, never deleted, so the
    // grant/revoke trail survives. Resolution also honours a deployment
    // allow-list (`PLATFORM_ADMIN_EMAILS` + the bootstrap email in
    // `lib/platformAdmin.ts`), so the first operator does not need a seeded row.
    platformAdmins: defineTable({
      email: v.string(), // normalized lowercase
      userId: v.optional(v.id("users")),
      status: v.union(v.literal("active"), v.literal("revoked")),
      grantedBy: v.optional(v.id("users")),
      note: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_email", ["email"])
      .index("by_user", ["userId"]),

    // Every operator action is recorded (T2.4). Full cross-tenant access is
    // powerful; the trail is what makes it reviewable.
    // Operator-managed plan & add-on catalog (billingPlans.ts). Global: no
    // tenant data. Money is integer minor units + ISO currency (AGENTS.md
    // rule 7). A row never grants anything by itself: entitlement comes from
    // a verified Stripe subscription item or an audited operator grant.
    billingPlans: defineTable({
      key: v.string(), // slug; for kind "plan" also the value stored in users.plan
      kind: v.union(v.literal("plan"), v.literal("addon")),
      name: v.string(),
      description: v.optional(v.string()),
      modules: v.array(v.string()), // registry ModuleIds this row unlocks
      priceMinor: v.number(), // e.g. 2900 = 29.00
      currency: v.string(), // ISO 4217, e.g. "EUR"
      interval: v.union(v.literal("month"), v.literal("year")),
      stripePriceId: v.optional(v.string()),
      trialDays: v.optional(v.number()),
      highlights: v.array(v.string()),
      status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
      sortOrder: v.number(),
      createdAt: v.number(),
      updatedAt: v.number(),
      updatedBy: v.id("users"),
    })
      .index("by_key", ["key"])
      .index("by_stripe_price", ["stripePriceId"]),

    // Add-ons an organization holds on top of its plan (mix and match).
    // Written only by the verified Stripe webhook or an audited operator
    // grant — never by a client-callable mutation.
    organizationAddons: defineTable({
      organizationId: v.id("organizations"),
      addonKey: v.string(),
      status: v.union(v.literal("active"), v.literal("canceled")),
      source: v.union(v.literal("stripe"), v.literal("operator")),
      stripeSubscriptionId: v.optional(v.string()),
      reason: v.optional(v.string()),
      grantedBy: v.optional(v.id("users")),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_organization_addon", ["organizationId", "addonKey"]),

    // Operator-managed allow-list of OpenRouter models (aiModels.ts). Global:
    // no tenant data. The gateway resolves the model from here.
    aiModels: defineTable({
      modelId: v.string(), // e.g. "anthropic/claude-sonnet-5"
      label: v.string(),
      description: v.optional(v.string()),
      enabled: v.boolean(),
      isDefault: v.boolean(),
      contextLength: v.optional(v.number()),
      promptUsdPerMillion: v.optional(v.number()),
      completionUsdPerMillion: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
      updatedBy: v.id("users"),
    }).index("by_model", ["modelId"]),

    adminAuditLog: defineTable({
      actorId: v.id("users"),
      actorEmail: v.optional(v.string()),
      action: v.string(),
      targetType: v.string(),
      targetId: v.optional(v.string()),
      detail: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_created", ["createdAt"])
      .index("by_target", ["targetType", "targetId"]),

    // ── Billing (T2.4): the local mirror of Stripe + the webhook ledger ────
    // Truth lives in the provider. Nothing here may write `active`, `paid` or
    // `succeeded` unless signature-verified, idempotent server code applied a
    // provider record — never a browser redirect (`AGENTS.md` §5 rules 5/7).

    // One Stripe customer per organization (connected-account model is E3.4;
    // MOSAI's own subscriptions bill to the platform account).
    billingCustomers: defineTable({
      organizationId: v.id("organizations"),
      provider: v.literal("stripe"),
      customerId: v.string(),
      email: v.optional(v.string()),
      livemode: v.boolean(),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_customer", ["customerId"]),

    // The subscription mirror. `lastEventCreated` is the out-of-order guard: a
    // delivery older than the last applied one is a no-op.
    subscriptions: defineTable({
      organizationId: v.id("organizations"),
      provider: v.literal("stripe"),
      subscriptionId: v.string(),
      customerId: v.string(),
      priceId: v.optional(v.string()),
      // The plan id from the capability registry, resolved from the price's
      // metadata. Never a free-text tier invented here.
      plan: v.string(),
      // Catalog add-on keys this subscription pays for (one per item whose
      // price is a billingPlans add-on). Mirrors Stripe; never client-written.
      addonKeys: v.optional(v.array(v.string())),
      status: v.string(), // canonical provider status (active, past_due, …)
      livemode: v.boolean(),
      currentPeriodEnd: v.optional(v.number()),
      cancelAtPeriodEnd: v.boolean(),
      // Set when a failed payment starts the wind-down; the sweep acts on it.
      windDownAt: v.optional(v.number()),
      dunningStage: v.number(),
      lastEventCreated: v.number(),
      lastEventId: v.optional(v.string()),
      // Set only by a successful provider reconciliation or a verified
      // subscription webhook. Deletion fails closed when this is stale.
      lastVerifiedAt: v.optional(v.number()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_organization_status", ["organizationId", "status"])
      .index("by_subscription", ["subscriptionId"])
      .index("by_status", ["status"]),

    // Webhook idempotency ledger. The provider event id is the unique key: a
    // duplicate delivery finds the row and changes nothing.
    billingEvents: defineTable({
      eventId: v.string(),
      type: v.string(),
      objectId: v.optional(v.string()),
      status: v.union(
        v.literal("processed"),
        v.literal("ignored"),
        v.literal("failed"),
      ),
      livemode: v.boolean(),
      note: v.optional(v.string()),
      created: v.number(),
      receivedAt: v.number(),
      processedAt: v.optional(v.number()),
    })
      .index("by_event_id", ["eventId"])
      .index("by_type", ["type"]),

    // Provider receipts (`AGENTS.md` §5 rule 6). A write that claims money
    // moved must be traceable to one of these rows.
    billingReceipts: defineTable({
      provider: v.literal("stripe"),
      objectType: v.string(),
      objectId: v.string(),
      eventId: v.string(),
      eventType: v.string(),
      organizationId: v.optional(v.id("organizations")),
      amountMinor: v.optional(v.number()),
      currency: v.optional(v.string()),
      livemode: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_object", ["objectType", "objectId"])
      .index("by_event", ["eventId"]),

    // Invoices, for dunning and the reconciliation report.
    billingInvoices: defineTable({
      organizationId: v.id("organizations"),
      subscriptionId: v.optional(v.string()),
      invoiceId: v.string(),
      status: v.string(), // draft | open | paid | void | uncollectible
      amountDueMinor: v.number(),
      amountPaidMinor: v.number(),
      currency: v.string(),
      hostedInvoiceUrl: v.optional(v.string()),
      attemptCount: v.number(),
      nextRetryAt: v.optional(v.number()),
      paidAt: v.optional(v.number()),
      livemode: v.boolean(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_organization", ["organizationId"])
      .index("by_invoice", ["invoiceId"]),

    // One row per reconciliation run. Target is `driftCount === 0`; a
    // non-zero run names every disagreement so support can resolve it.
    reconciliationRuns: defineTable({
      source: v.string(), // cron | manual | snapshot
      startedAt: v.number(),
      finishedAt: v.number(),
      checked: v.number(),
      driftCount: v.number(),
      drifts: v.array(
        v.object({
          organizationId: v.optional(v.id("organizations")),
          subscriptionId: v.optional(v.string()),
          kind: v.string(),
          local: v.optional(v.string()),
          provider: v.optional(v.string()),
          detail: v.string(),
        }),
      ),
      createdAt: v.number(),
    }).index("by_started", ["startedAt"]),

    // Durable privacy work. A deletion request is not a transient cron
    // argument: the job survives retries and records its effective date and
    // progress. Export payloads are stored in bounded chunks.
    privacyJobs: defineTable({
      kind: v.union(v.literal("account_deletion"), v.literal("project_deletion"), v.literal("account_export"), v.literal("project_export")),
      userId: v.id("users"),
      status: v.union(
        v.literal("queued"),
        v.literal("running"),
        v.literal("waiting_for_user"),
        v.literal("succeeded"),
        v.literal("partially_succeeded"),
        v.literal("failed"),
        v.literal("canceled"),
      ),
      idempotencyKey: v.string(),
      requestedAt: v.number(),
      effectiveAt: v.optional(v.number()),
      exportProjectId: v.optional(v.id("projects")),
      // Scheduler fairness marker: an omitted value means the job has not yet
      // received a worker turn. Updated atomically with each export step.
      lastServedAt: v.optional(v.number()),
      cursor: v.optional(v.string()),
      completedCount: v.number(),
      blockedReason: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_kind", ["userId", "kind"])
      .index("by_status_effective", ["status", "effectiveAt"])
      .index("by_status_kind_effective", ["status", "kind", "effectiveAt"])
      .index("by_status_kind_served", ["status", "kind", "lastServedAt"])
      .index("by_idempotency", ["idempotencyKey"]),

    privacyExportChunks: defineTable({
      jobId: v.id("privacyJobs"),
      exportProjectId: v.optional(v.id("projects")),
      sequence: v.number(),
      json: v.string(),
      bytes: v.number(),
      createdAt: v.number(),
      expiresAt: v.number(),
    })
      .index("by_job_sequence", ["jobId", "sequence"])
      .index("by_expires", ["expiresAt"]),

    // ── Website / CMS module (W1 foundation) — see WEBSITE-ARCHITECTURE.md ─
    // Canonical ownership: CMS owns layout/presentation. Products, prices,
    // availability, contacts and consent are referenced, never copied.

    // One site per project in W1 (domain model stays extensible to many).
    sites: defineTable({
      projectId: v.id("projects"),
      name: v.string(),
      slug: v.string(),
      // draft | live | suspended — site status is separate from publication
      status: v.optional(
        v.union(v.literal("draft"), v.literal("live"), v.literal("suspended")),
      ),
      defaultLocale: v.optional(v.string()),
      homepageId: v.optional(v.id("cmsPages")),
      // Site-level SEO defaults (§29): name, title template, social image
      seoDefaults: v.optional(
        v.object({
          siteName: v.optional(v.string()),
          titleTemplate: v.optional(v.string()),
          metaDescription: v.optional(v.string()),
          socialImageUrl: v.optional(v.string()),
        }),
      ),
      // Brand-driven theme tokens (§39-40) — semantic, not raw hex in blocks
      theme: v.optional(
        v.object({
          accent: v.optional(v.string()),
          radius: v.optional(v.string()),
          fontScale: v.optional(v.string()),
        }),
      ),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_project", ["projectId"]),

    // Page identity. Content lives in immutable revisions below.
    cmsPages: defineTable({
      siteId: v.id("sites"),
      projectId: v.id("projects"),
      title: v.string(),
      slug: v.string(), // normalized, unique within site
      fullPath: v.string(), // derived: parent path + slug, unique within site
      parentId: v.optional(v.id("cmsPages")),
      // standard | homepage | landing | article | product | collection | utility
      pageType: v.optional(v.string()),
      // draft | release_prepared | archived. `release_prepared` (owner
      // decision, 24 Sep 2026) replaces `published`: a page promotion is a
      // local preparation, never proof of external delivery. `published` is
      // a LEGACY literal kept only so pre-rename rows validate until
      // `cmsReleaseMigration.migratePublishedToReleasePrepared` has run;
      // no code path writes it any more.
      status: v.union(
        v.literal("draft"),
        v.literal("release_prepared"),
        v.literal("published"), // legacy, read-only
        v.literal("archived"),
      ),
      publishedRevisionId: v.optional(v.id("pageRevisions")),
      latestDraftRevisionId: v.optional(v.id("pageRevisions")),
      // Per-page SEO overrides (§29). Missing fields fall back to site defaults.
      seo: v.optional(
        v.object({
          title: v.optional(v.string()),
          metaDescription: v.optional(v.string()),
          noindex: v.optional(v.boolean()),
          ogImageUrl: v.optional(v.string()),
        }),
      ),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_site", ["siteId"])
      .index("by_project", ["projectId"])
      .index("by_site_path", ["siteId", "fullPath"]),

    // Immutable revision snapshots. Editing a published page creates a newer
    // draft; publishing promotes the draft; prior published → superseded.
    pageRevisions: defineTable({
      pageId: v.id("cmsPages"),
      projectId: v.id("projects"),
      version: v.number(), // monotonically increasing per page
      // draft | release_prepared | superseded. `published` is the legacy
      // name for `release_prepared` (see cmsPages.status above); kept in the
      // union only so pre-rename rows validate until the migration has run.
      state: v.union(
        v.literal("draft"),
        v.literal("release_prepared"),
        v.literal("published"), // legacy, read-only
        v.literal("superseded"),
      ),
      // structured PageDocument — never canonical HTML
      document: v.object({
        schemaVersion: v.number(),
        blocks: v.array(
          v.object({
            id: v.string(),
            type: v.string(),
            version: v.number(),
            props: v.any(),
          }),
        ),
      }),
      createdBy: v.id("users"),
      createdAt: v.number(),
      publishedAt: v.optional(v.number()),
    })
      .index("by_page", ["pageId"])
      .index("by_project", ["projectId"]),

    // Canonical asset library (§26). W1 stores URL references (uploads to
    // Convex storage land in W3); deletion is blocked while referenced.
    cmsAssets: defineTable({
      projectId: v.id("projects"),
      type: v.union(
        v.literal("image"),
        v.literal("video"),
        v.literal("document"),
        v.literal("logo"),
      ),
      filename: v.string(),
      url: v.string(),
      mimeType: v.optional(v.string()),
      altText: v.optional(v.string()),
      title: v.optional(v.string()),
      source: v.optional(v.string()), // upload | external | content
      createdBy: v.id("users"),
      createdAt: v.number(),
    }).index("by_project", ["projectId"]),

    // Menus (§25). Items reference real pages — validated before publish.
    cmsNavigations: defineTable({
      siteId: v.id("sites"),
      projectId: v.id("projects"),
      name: v.string(),
      items: v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          // page | external | collection
          type: v.string(),
          referenceId: v.optional(v.id("cmsPages")),
          url: v.optional(v.string()),
          openInNewTab: v.optional(v.boolean()),
        }),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_site", ["siteId"])
      .index("by_project", ["projectId"]),

    // Redirects (§33). Auto-created when a published path changes; loops are
    // rejected at write time.
    cmsRedirects: defineTable({
      siteId: v.id("sites"),
      projectId: v.id("projects"),
      fromPath: v.string(),
      to: v.string(),
      statusCode: v.union(v.literal(301), v.literal(302)),
      // manual | auto_path_change
      source: v.optional(v.string()),
      createdAt: v.number(),
    })
      .index("by_site_path", ["siteId", "fromPath"])
      .index("by_project", ["projectId"]),

    // Per-user AI/scraping budget buckets (pack T0.4). One row per user and
    // fixed time window; written only by the internal `guards.consumeAiQuota`
    // mutation that the server-side AI actions call before spending a
    // provider call. Ephemeral: expired rows are dropped opportunistically.
    aiRateLimits: defineTable({
      userId: v.id("users"),
      windowStart: v.number(), // epoch ms, aligned to AI_QUOTA_WINDOW_MS
      count: v.number(),
    }).index("by_user_window", ["userId", "windowStart"]),

    // Per-user budget for paid lookup APIs (SerpApi Google Maps search while
    // typing, business-listing confirmation). Separate from the AI quota so
    // typing in a search box never eats the user's AI requests.
    lookupRateLimits: defineTable({
      userId: v.id("users"),
      kind: v.string(), // e.g. "google_maps"
      windowStart: v.number(), // epoch ms, aligned to LOOKUP_QUOTA_WINDOW_MS
      count: v.number(),
    }).index("by_user_kind_window", ["userId", "kind", "windowStart"]),

    // Safe AI usage telemetry only: no prompt, output, or provider error text.
    // One row records one model request; userId is the data owner even when a
    // project reference is present. Project/account deletion removes the row.
    aiRuns: defineTable({
      userId: v.id("users"),
      projectId: v.optional(v.id("projects")),
      organizationId: v.optional(v.id("organizations")),
      agentId: v.string(),
      promptVersion: v.string(),
      provider: v.union(v.literal("vly"), v.literal("openrouter")),
      model: v.string(),
      autonomy: v.union(v.literal("assistive"), v.literal("draft")),
      maxOutputTokens: v.number(),
      contextSources: v.array(v.string()),
      status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed")),
      promptTokens: v.union(v.number(), v.null()),
      completionTokens: v.union(v.number(), v.null()),
      totalTokens: v.union(v.number(), v.null()),
      providerCredits: v.union(v.number(), v.null()),
      costMicrousd: v.union(v.number(), v.null()),
      costCurrency: v.union(v.literal("USD"), v.null()),
      errorCategory: v.union(
        v.null(),
        v.literal("provider_error"),
        v.literal("empty_response"),
        v.literal("invalid_request"),
        v.literal("invalid_output"),
      ),
      startedAt: v.number(),
      finishedAt: v.optional(v.number()),
      latencyMs: v.optional(v.number()),
      // AI budget (lib/aiBudget.ts), integer micro-USD. `reservedMicrousd` is
      // the worst-case cost held against the budget while the run is
      // `running`; `chargedMicrousd` is what the finished run counts. Optional
      // so rows written before the budget existed stay valid.
      reservedMicrousd: v.optional(v.number()),
      chargedMicrousd: v.optional(v.number()),
    })
      .index("by_user_created", ["userId", "startedAt"])
      .index("by_project", ["projectId"])
      .index("by_org_started", ["organizationId", "startedAt"]),

    // AI budget rollups: one row per organization (or unattributed user) per
    // UTC month, plus one platform row per UTC day. Counters only — no prompt,
    // output or model data. Written solely by the internal gateway mutations
    // (guards.startAiRun / finishAiRun) so the budget check reads two rows
    // instead of scanning runs.
    aiSpendRollups: defineTable({
      scope: v.union(v.literal("organization"), v.literal("user"), v.literal("platform")),
      organizationId: v.optional(v.id("organizations")),
      userId: v.optional(v.id("users")),
      period: v.string(), // "2026-09" (organization/user) or "2026-09-24" (platform)
      spentMicrousd: v.number(),
      reservedMicrousd: v.number(),
      runCount: v.number(),
      currency: v.literal("USD"),
      updatedAt: v.number(),
    })
      .index("by_organization", ["organizationId", "period"])
      .index("by_user", ["userId", "period"])
      .index("by_scope_period", ["scope", "period"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
