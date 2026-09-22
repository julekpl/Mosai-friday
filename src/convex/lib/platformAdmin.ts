/**
 * Platform operator registry (MOSAI pack T2.4 admin slice).
 *
 * An operator is a MOSAI employee who may see and act across every tenant:
 * the app admin panel (`/admin`), global settings, plan overrides for support,
 * the webhook ledger and the reconciliation report.
 *
 * This is deliberately **not** an organization role (`lib/roles.ts` is the
 * tenant map) and **not** a module capability (`lib/capabilities.ts` is the
 * add-on map). Operator access is a deployment-level allow-list:
 *
 *   1. `users.isPlatformAdmin === true` — an explicit grant, recorded in the
 *      `platformAdmins` table and auditable;
 *   2. `users.role === "admin"` — the pre-existing role, kept working so this
 *      slice does not lock anyone out;
 *   3. an **email on the allow-list** — `PLATFORM_ADMIN_EMAILS` (comma
 *      separated, read from the deployment env) plus the bootstrap addresses
 *      below. This is how the first operator exists without a seeded row.
 *
 * Keep this module dependency-free so the admin module, the tests and (later)
 * a script can all import it. Never grant operator access from a client —
 * `requirePlatformAdmin` is the only entry point and it resolves server-side.
 */

/** The bootstrap operators. Kept as code (not a secret) so a fresh deployment
 *  has exactly one way in; the owner can extend the list with the
 *  `PLATFORM_ADMIN_EMAILS` env var through the Keys / API keys UI. */
export const DEFAULT_PLATFORM_ADMIN_EMAILS: readonly string[] = [
  "julian.s.witkowski@gmail.com",
];

/** Normalize an email for comparison (trim + lowercase). */
export function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  return normalized.length ? normalized : null;
}

/** The deployment's allow-list: the env var (if set) plus the bootstrap list. */
export function platformAdminEmails(): string[] {
  const fromEnv = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => normalizeEmail(value))
    .filter((value): value is string => Boolean(value));
  const bootstrap = DEFAULT_PLATFORM_ADMIN_EMAILS.map((value) =>
    normalizeEmail(value),
  ).filter((value): value is string => Boolean(value));
  return [...new Set([...bootstrap, ...fromEnv])];
}

/** True when the email is on the deployment allow-list. */
export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return platformAdminEmails().includes(normalized);
}
