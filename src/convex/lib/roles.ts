/**
 * Organization roles and capabilities (MOSAI pack T2.1).
 *
 * One canonical, side-effect-free definition of the roles an organization
 * member can hold and what each role may do. The rows in the `roles` table are
 * seeded from here, `guards.requireOrgRole` enforces from here, and the tests
 * assert against here — so the UI, the server and the audit can never disagree
 * about what "admin" means.
 *
 * Keep this module dependency-free (only `convex/values`) so it can be imported
 * by the schema, the guards and the module without an import cycle.
 */

import { v } from "convex/values";

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const orgRoleValidator = v.union(
  v.literal(ORG_ROLES[0]),
  v.literal(ORG_ROLES[1]),
  v.literal(ORG_ROLES[2]),
);

/** Higher rank = more authority. Used to stop an admin granting a role at or
 *  above their own, and to keep "at least one owner" meaningful. */
export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export const ORG_CAPABILITIES = [
  "member.invite",
  "member.remove",
  "member.update_role",
  "organization.update",
  "organization.delete",
  "agency.link",
  "agency.unlink",
] as const;
export type OrgCapability = (typeof ORG_CAPABILITIES)[number];

/** What each role may do. A member is read-only until promoted. An admin runs
 *  the day-to-day (invite, remove, link clients) but cannot delete the
 *  organization or hand out ownership. Owner holds everything. */
export const ROLE_CAPABILITIES: Record<OrgRole, readonly OrgCapability[]> = {
  owner: [...ORG_CAPABILITIES],
  admin: [
    "member.invite",
    "member.remove",
    "member.update_role",
    "organization.update",
    "agency.link",
    "agency.unlink",
  ],
  member: [],
};

export function roleCan(role: OrgRole, capability: OrgCapability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

export function isValidOrgRole(role: string): role is OrgRole {
  return (ORG_ROLES as readonly string[]).includes(role);
}
