/**
 * Schema / data registry (MOSAI pack T2.1 seed; T2.5 expands it to every table).
 *
 * AGENTS.md rule 12: every table is registered for authorization, export,
 * retention and deletion. Today the deletion-completeness regression derives
 * *project-scoped* tables from `schema.ts` automatically; the organization
 * tables added in T2.1 are not project-scoped, so this registry is where their
 * tenancy field and lifecycle policy are declared. T2.5 replaces this with the
 * full data registry, the unified export/deletion engine and the finalizer.
 *
 * Keep this declarative and dependency-free — it is read by tests and, later,
 * by the export/deletion jobs.
 */

export type TableScope = "project" | "organization" | "user" | "global";

export type ExportPolicy = "included" | "excluded";

export type RetentionPolicy =
  | "cascade-with-project"
  | "cascade-with-organization"
  | "cascade-with-user"
  | "kept-until-revoked"
  | "ephemeral";

export interface TableRegistryEntry {
  /** What the row belongs to — the boundary authorization checks against. */
  scope: TableScope;
  /** Field carrying the tenant id used to authorize a row. */
  tenantField: string;
  /** How reads/writes are authorized (which guard enforces it). */
  authorization: string;
  export: ExportPolicy;
  retention: RetentionPolicy;
}

export const DATA_REGISTRY: Record<string, TableRegistryEntry> = {
  organizations: {
    scope: "organization",
    tenantField: "_id",
    authorization: "guards.requireOrganization (active membership)",
    export: "excluded",
    retention: "cascade-with-user",
  },
  memberships: {
    scope: "organization",
    tenantField: "organizationId",
    authorization: "guards.requireOrganization / guards.requireOrgRole",
    export: "excluded",
    retention: "cascade-with-organization",
  },
  invitations: {
    scope: "organization",
    tenantField: "organizationId",
    authorization: "guards.requireOrganization / membership.invite capability",
    export: "excluded",
    retention: "ephemeral",
  },
  roles: {
    scope: "global",
    tenantField: "_id",
    authorization: "seeded server-side; read through organizations.members",
    export: "excluded",
    retention: "kept-until-revoked",
  },
  agencyClientLinks: {
    scope: "organization",
    tenantField: "agencyId",
    authorization: "guards.requireOrgRole (agency.link / agency.unlink)",
    export: "excluded",
    retention: "kept-until-revoked",
  },

  // ── T2.4: platform operators and billing ─────────────────────────────────
  platformAdmins: {
    scope: "user",
    tenantField: "userId",
    authorization: "guards.requirePlatformAdmin (server-only; never client-grantable)",
    export: "excluded",
    retention: "kept-until-revoked",
  },
  adminAuditLog: {
    scope: "global",
    tenantField: "_id",
    authorization: "guards.requirePlatformAdmin (read); written by guarded admin mutations",
    export: "excluded",
    retention: "kept-until-revoked",
  },
  billingCustomers: {
    scope: "organization",
    tenantField: "organizationId",
    authorization: "guards.requireOrganization (billing.subscription) / internal billing helpers",
    export: "included",
    retention: "cascade-with-organization",
  },
  subscriptions: {
    scope: "organization",
    tenantField: "organizationId",
    authorization: "guards.requireOrganization (billing.subscription) / internal webhook + reconciliation",
    export: "included",
    retention: "cascade-with-organization",
  },
  billingEvents: {
    scope: "global",
    tenantField: "_id",
    authorization: "guards.requirePlatformAdmin (admin.billingEvents) / written only by the verified webhook",
    export: "excluded",
    retention: "kept-until-revoked",
  },
  billingReceipts: {
    scope: "organization",
    tenantField: "organizationId",
    authorization: "written only by the verified webhook; read through the admin panel",
    export: "included",
    retention: "kept-until-revoked",
  },
  billingInvoices: {
    scope: "organization",
    tenantField: "organizationId",
    authorization: "guards.requireOrganization (billing.subscription) / internal webhook",
    export: "included",
    retention: "kept-until-revoked",
  },
  reconciliationRuns: {
    scope: "global",
    tenantField: "_id",
    authorization: "guards.requirePlatformAdmin (admin.reconciliation)",
    export: "excluded",
    retention: "kept-until-revoked",
  },
};
