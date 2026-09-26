/**
 * Provenance contract (MVP plan CT-1 + KIT-2): who said a value is true, and
 * whether a new write may replace it.
 *
 * The product promise (AGENTS.md section 1) is that MOSAI "never undoes what
 * the owner told it". Every writer that fills a field the owner can also
 * confirm (today: `projects.businessProfile`) asks `decideWrite` first. A
 * field the owner confirmed or locked is never silently replaced by an AI
 * draft, a website scan or provider text; the new value becomes a suggestion
 * the owner can accept later.
 *
 * Dependency-free and importable from both the Convex backend and React.
 */

/**
 * The authority ladder, strongest first:
 *
 * - `user_locked`: the owner locked the value. Nothing but another explicit
 *   lock by the owner replaces it.
 * - `user_confirmed`: the owner typed, reviewed or confirmed the value
 *   (first-run answers count here).
 * - `first_party`: read from a source the owner controls and connected
 *   (their own website, their own Google listing).
 * - `provider` / `external`: read from a third party or a public source.
 * - `inferred`: an AI guess.
 */
export const AUTHORITIES = [
  "user_locked",
  "user_confirmed",
  "first_party",
  "provider",
  "external",
  "inferred",
] as const;
export type Authority = (typeof AUTHORITIES)[number];

/** Higher rank = stronger. `provider` and `external` share a rung. */
export const AUTHORITY_RANK: Record<Authority, number> = {
  user_locked: 5,
  user_confirmed: 4,
  first_party: 3,
  provider: 2,
  external: 2,
  inferred: 1,
};

export function isAuthority(value: unknown): value is Authority {
  return typeof value === "string" && (AUTHORITIES as readonly string[]).includes(value);
}

/** True for authorities only the owner can grant. */
export function isOwnerAuthority(authority: Authority | undefined): boolean {
  return authority === "user_locked" || authority === "user_confirmed";
}

/**
 * A pointer to the evidence behind a value, as a canonical reference
 * (docs/pack/08 module contracts): a kind of source and its id, optionally a
 * version and a short human label. Evidence is data, never instructions.
 */
export type EvidenceRef = {
  type: string;
  id: string;
  version?: string;
  label?: string;
};

/** Per-field provenance stored next to a profile (`projects.profileAuthority`). */
export type FieldAuthority = {
  authority: Authority;
  confirmedAt?: number;
  sourceRefs?: EvidenceRef[];
};

/**
 * May a write with `incoming` authority replace a value held at `existing`?
 *
 * - No existing authority: yes (nothing to protect).
 * - A locked value: only another owner lock replaces it.
 * - An owner-confirmed value: only the owner (confirm or lock) replaces it;
 *   no machine source ever does, however strong.
 * - Otherwise: an equal or stronger source replaces a weaker one, and a
 *   weaker source never beats a stronger one.
 */
export function canOverwrite(existing: Authority | undefined, incoming: Authority): boolean {
  if (!existing) return true;
  if (existing === "user_locked") return incoming === "user_locked";
  if (existing === "user_confirmed") return isOwnerAuthority(incoming);
  return AUTHORITY_RANK[incoming] >= AUTHORITY_RANK[existing];
}

/**
 * The three outcomes of a write attempt:
 * - `write`: store the incoming value;
 * - `suggest`: keep the existing value, offer the incoming one to the owner;
 * - `keep`: keep the existing value and drop the incoming one (the owner
 *   locked it, so it is not even worth asking).
 */
export type WriteDecision = "write" | "suggest" | "keep";

export function decideWrite(existing: Authority | undefined, incoming: Authority): WriteDecision {
  if (canOverwrite(existing, incoming)) return "write";
  return existing === "user_locked" ? "keep" : "suggest";
}
