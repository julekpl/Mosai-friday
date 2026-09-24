/**
 * Canonical privacy registry. New Convex tables must declare authorization,
 * export, retention and deletion policy here; `audit:data-registry` checks the
 * registry against the executable schema.
 */

export type TableScope = "project" | "organization" | "user" | "global";
export type ExportPolicy = "included" | "excluded";
export type RetentionPolicy =
  | "cascade-with-project"
  | "cascade-with-organization"
  | "cascade-with-user"
  | "kept-until-revoked"
  | "ephemeral";

export type DeletionPolicy =
  | { kind: "project-cascade"; index: "by_project"; field: "projectId" }
  | { kind: "account-index"; index: string; field: string }
  | { kind: "account-parent"; parentTable: string; parentIndex: string; childIndex: string; childField: string }
  | { kind: "organization-policy"; index: "by_organization"; field: "organizationId" }
  | { kind: "organization-links"; agencyIndex: "by_agency"; clientIndex: "by_client"; agencyField: "agencyId"; clientField: "clientId" }
  | { kind: "sole-owner"; index: "by_owner"; field: "ownerId" }
  | { kind: "subject" }
  | { kind: "retain"; reason: string }
  | { kind: "ephemeral"; reason: string };

export type AccountCleanupChild = { table: string; index: string; field: string };
export type AccountCleanupRule =
  | { kind: "index"; index: string; field: string; source: "user" | "email" }
  | { kind: "parent-children"; parentIndex: string; parentField: "userId"; children: AccountCleanupChild[] }
  | { kind: "export-jobs"; parentIndex: string; parentField: "userId"; parentKindField: "kind"; parentKinds: string[]; childIndex: string; childField: "jobId" }
  | { kind: "lifecycle"; reason: string };

export interface TableRegistryEntry {
  scope: TableScope;
  tenantField: string;
  authorization: string;
  export: ExportPolicy;
  retention: RetentionPolicy;
  deletion: DeletionPolicy;
  accountCleanup?: AccountCleanupRule[];
}

const project = (authorization: string, exportPolicy: ExportPolicy = "included"): TableRegistryEntry => ({
  scope: "project", tenantField: "projectId", authorization, export: exportPolicy,
  retention: "cascade-with-project", deletion: { kind: "project-cascade", index: "by_project", field: "projectId" },
});
const organization = (authorization: string, exportPolicy: ExportPolicy = "included"): TableRegistryEntry => ({
  scope: "organization", tenantField: "organizationId", authorization, export: exportPolicy,
  retention: "cascade-with-organization", deletion: { kind: "organization-policy", index: "by_organization", field: "organizationId" },
});
const user = (field: string, authorization: string, exportPolicy: ExportPolicy = "excluded", index = field): TableRegistryEntry => ({
  scope: "user", tenantField: field, authorization, export: exportPolicy,
  retention: "cascade-with-user", deletion: { kind: "account-index", index, field },
});
const global = (authorization: string, reason: string, ephemeral = false): TableRegistryEntry => ({
  scope: "global", tenantField: "_id", authorization, export: "excluded",
  retention: ephemeral ? "ephemeral" : "kept-until-revoked",
  deletion: ephemeral ? { kind: "ephemeral", reason } : { kind: "retain", reason },
});

export const DATA_REGISTRY: Record<string, TableRegistryEntry> = {
  // Convex Auth. Credentials, codes, sessions and rate limits are never
  // exported. Account deletion removes the user-owned auth rows explicitly.
  users: { scope: "user", tenantField: "_id", authorization: "guards.requireUser (self)", export: "included", retention: "cascade-with-user", deletion: { kind: "subject" }, accountCleanup: [{ kind: "lifecycle", reason: "Deleted last after every registry cleanup phase" }] },
  authSessions: { ...user("userId", "Convex Auth session ownership", "excluded", "userId"), accountCleanup: [{ kind: "parent-children", parentIndex: "userId", parentField: "userId", children: [{ table: "authRefreshTokens", index: "sessionId", field: "sessionId" }] }] },
  authAccounts: { ...user("userId", "Convex Auth account ownership", "excluded", "userIdAndProvider"), accountCleanup: [{ kind: "parent-children", parentIndex: "userIdAndProvider", parentField: "userId", children: [{ table: "authVerificationCodes", index: "accountId", field: "accountId" }] }] },
  authRefreshTokens: { scope: "user", tenantField: "sessionId", authorization: "Convex Auth session ownership", export: "excluded", retention: "cascade-with-user", deletion: { kind: "account-parent", parentTable: "authSessions", parentIndex: "userId", childIndex: "sessionId", childField: "sessionId" }, accountCleanup: [{ kind: "lifecycle", reason: "Deleted child-first by the authSessions account cleanup rule" }] },
  authVerificationCodes: { scope: "user", tenantField: "accountId", authorization: "Convex Auth account ownership", export: "excluded", retention: "ephemeral", deletion: { kind: "account-parent", parentTable: "authAccounts", parentIndex: "userIdAndProvider", childIndex: "accountId", childField: "accountId" }, accountCleanup: [{ kind: "lifecycle", reason: "Deleted child-first by the authAccounts account cleanup rule" }] },
  authVerifiers: { scope: "global", tenantField: "_id", authorization: "Convex Auth ephemeral verifier cleanup", export: "excluded", retention: "ephemeral", deletion: { kind: "ephemeral", reason: "OAuth verifiers expire and are removed by the auth provider" }, accountCleanup: [{ kind: "lifecycle", reason: "OAuth verifiers are ephemeral and removed by the auth provider" }] },
  authRateLimits: global("Convex Auth rate limiter", "Rate limits expire by policy", true),
  otpEmailReceipts: global("Internal OTP sender only; no address or code stored", "SMTP acceptance receipts expire after 30 days and are removed by a scheduled sweep", true),

  organizations: { scope: "organization", tenantField: "_id", authorization: "guards.requireOrganization", export: "excluded", retention: "cascade-with-user", deletion: { kind: "sole-owner", index: "by_owner", field: "ownerId" }, accountCleanup: [{ kind: "lifecycle", reason: "Shared organizations transfer to one successor; sole-owned organizations cascade child-first" }] },
  memberships: { scope: "organization", tenantField: "organizationId", authorization: "guards.requireOrganization / requireOrgRole", export: "excluded", retention: "cascade-with-organization", deletion: { kind: "organization-policy", index: "by_organization", field: "organizationId" }, accountCleanup: [{ kind: "index", index: "by_user", field: "userId", source: "user" }] },
  invitations: { ...organization("guards.requireOrgRole", "excluded"), accountCleanup: [{ kind: "index", index: "by_email", field: "email", source: "email" }, { kind: "index", index: "by_invited_by", field: "invitedBy", source: "user" }] },
  roles: global("Seeded role registry", "Canonical role definitions are shared"),
  agencyClientLinks: { scope: "organization", tenantField: "agencyId", authorization: "guards.requireOrgRole", export: "excluded", retention: "cascade-with-organization", deletion: { kind: "organization-links", agencyIndex: "by_agency", clientIndex: "by_client", agencyField: "agencyId", clientField: "clientId" }, accountCleanup: [{ kind: "lifecycle", reason: "Organization links are removed only when their sole-owned organization is deleted" }] },
  projects: { ...user("ownerId", "guards.requireProject (owner)", "included", "by_owner"), accountCleanup: [{ kind: "lifecycle", reason: "Project data is cascaded or ownership is transferred before account cleanup" }] },

  personas: project("guards.requireProject"), contentPieces: project("guards.requireProject"),
  connections: project("guards.requireProject", "excluded"), contacts: project("guards.requireProject"),
  campaigns: project("guards.requireProject"), posts: project("guards.requireProject"),
  socialCredentials: project("guards.requireProject", "excluded"), products: project("guards.requireProject"),
  productVariants: project("guards.requireProject"),
  productMedia: { scope: "project", tenantField: "productId", authorization: "parent products project ownership", export: "included", retention: "cascade-with-project", deletion: { kind: "account-parent", parentTable: "products", parentIndex: "by_project", childIndex: "by_product", childField: "productId" } },
  collections: project("guards.requireProject"), commerceEvents: project("guards.requireProject"),
  insights: project("guards.requireProject"), builds: project("guards.requireProject"),
  buildReleaseAudits: project("guards.requireProject", "excluded"), buildDeployments: project("guards.requireProject", "excluded"),
  buildPages: project("guards.requireProject"),
  buildMessages: { scope: "project", tenantField: "buildId", authorization: "parent builds project ownership", export: "included", retention: "cascade-with-project", deletion: { kind: "account-parent", parentTable: "builds", parentIndex: "by_project", childIndex: "by_build", childField: "buildId" } },
  buildVersions: { scope: "project", tenantField: "buildId", authorization: "parent builds project ownership", export: "included", retention: "cascade-with-project", deletion: { kind: "account-parent", parentTable: "builds", parentIndex: "by_project", childIndex: "by_build", childField: "buildId" } },
  projectFiles: project("guards.requireProject"),
  journeyMaps: project("guards.requireProject"), contentGaps: project("guards.requireProject"),
  contentTopics: project("guards.requireProject"),
  contentDocs: { scope: "project", tenantField: "pieceId", authorization: "parent contentPieces project ownership", export: "included", retention: "cascade-with-project", deletion: { kind: "account-parent", parentTable: "contentPieces", parentIndex: "by_project", childIndex: "by_piece", childField: "pieceId" } },
  personaMessages: { scope: "project", tenantField: "projectId", authorization: "guards.requireProject", export: "included", retention: "cascade-with-project", deletion: { kind: "account-index", index: "by_project_persona", field: "projectId" } },
  communications: project("guards.requireProject"), adsCredentials: project("guards.requireProject", "excluded"),
  oauthStates: { ...global("OAuth callback state", "Short-lived callback state expires", true), accountCleanup: [{ kind: "index", index: "by_user", field: "createdBy", source: "user" }] },
  adsAccounts: project("guards.requireProject"), adsCampaigns: project("guards.requireProject"),
  adsMetrics: project("guards.requireProject"), adsChangeRequests: project("guards.requireProject"),
  // Grow — Google (GA4 / Search Console / Ads). Tokens are never exported.
  googleConnections: project("moduleQuery/moduleMutation grow → access.requireProject", "excluded"),
  googleSyncRuns: project("moduleQuery grow → access.ownedProject", "excluded"),
  googleMetricsDaily: project("moduleQuery grow → access.ownedProject"),
  googleTopItems: project("moduleQuery grow → access.ownedProject"),
  adsExecutions: project("guards.requireProject", "excluded"), adsCopilotMessages: project("guards.requireProject"),
  appSettings: global("Server-managed settings", "Shared server configuration is retained"),
  platformAdmins: user("userId", "guards.requirePlatformAdmin", "excluded", "by_user"),
  adminAuditLog: global("guards.requirePlatformAdmin", "Operator audit records are retained"),
  billingCustomers: { ...organization("Verified Stripe webhook / billing access"), accountCleanup: [{ kind: "lifecycle", reason: "Removed only after subscription obligations are verified and the sole-owned organization is cascaded" }] },
  subscriptions: { ...organization("Verified Stripe webhook / reconciliation"), accountCleanup: [{ kind: "lifecycle", reason: "Removed only after subscription obligations are verified and the sole-owned organization is cascaded" }] },
  billingEvents: global("Verified Stripe webhook", "Provider event ledger is retained"),
  billingReceipts: { scope: "organization", tenantField: "organizationId", authorization: "guards.requirePlatformAdmin / verified Stripe webhook", export: "excluded", retention: "kept-until-revoked", deletion: { kind: "retain", reason: "Financial receipts remain available for legal and audit retention" }, accountCleanup: [{ kind: "lifecycle", reason: "Retained under the financial receipt retention policy" }] },
  billingInvoices: { ...organization("Verified Stripe webhook / billing access", "excluded"), accountCleanup: [{ kind: "lifecycle", reason: "Removed only with the verified sole-owned organization cascade" }] },
  reconciliationRuns: global("guards.requirePlatformAdmin", "Billing reconciliation evidence is retained"),
  sites: project("guards.requireProject"), cmsPages: project("guards.requireProject"),
  pageRevisions: project("guards.requireProject"), cmsAssets: project("guards.requireProject"),
  cmsNavigations: project("guards.requireProject"), cmsRedirects: project("guards.requireProject"),
  aiRateLimits: { ...user("userId", "Internal AI quota guard", "excluded", "by_user_window"), accountCleanup: [{ kind: "index", index: "by_user_window", field: "userId", source: "user" }] },
  lookupRateLimits: { ...user("userId", "Internal paid-lookup quota guard", "excluded", "by_user_kind_window"), accountCleanup: [{ kind: "index", index: "by_user_kind_window", field: "userId", source: "user" }] },
  // A run may have a projectId or be user-only. Project deletion clears the
  // former; account cleanup clears either form through the user index.
  aiRuns: { ...project("Internal AI gateway; project actions require project authorization", "excluded"), accountCleanup: [{ kind: "index", index: "by_user_created", field: "userId", source: "user" }] },
  privacyJobs: { scope: "global", tenantField: "_id", authorization: "self-scoped job reads / internal finalizer / operator report", export: "excluded", retention: "kept-until-revoked", deletion: { kind: "retain", reason: "Minimal deletion-job receipt supports audit and retry history" } },
  privacyExportChunks: { scope: "user", tenantField: "jobId", authorization: "parent privacyJobs owner", export: "excluded", retention: "cascade-with-user", deletion: { kind: "account-parent", parentTable: "privacyJobs", parentIndex: "by_user", childIndex: "by_job_sequence", childField: "jobId" }, accountCleanup: [{ kind: "export-jobs", parentIndex: "by_user", parentField: "userId", parentKindField: "kind", parentKinds: ["account_export", "project_export"], childIndex: "by_job_sequence", childField: "jobId" }] },
};

// Account-scoped rows that are directly owned by a user are explicit policies;
// T2.5's registry audit rejects user/organization rows without a cleanup rule.
DATA_REGISTRY.platformAdmins.accountCleanup = [{ kind: "index", index: "by_user", field: "userId", source: "user" }];

export const ACCOUNT_DELETION_GRACE_DAYS = 30;
export const ACCOUNT_DELETION_GRACE_MS = ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000;
export const SUBSCRIPTION_VERIFICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
