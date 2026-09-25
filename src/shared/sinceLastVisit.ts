/**
 * U7 — "Since you were away". Pure summary of what changed for one caller
 * since their own `lastSeenAt`, built only from existing rows.
 *
 * Truth rules (AGENTS.md §5.5):
 * - a post counts as "went out" only when it is `published`, carries a
 *   provider receipt (`providerRef`) and was published after `since`;
 * - the website counts as "went live" only from a server-confirmed
 *   (`succeeded`) self-hosted deployment finished after `since` while the
 *   site is live now (the same truth source as `siteHosting.status`);
 * - a module the plan does not include is omitted (undefined), never 0.
 */

export type SincePost = {
  status: string;
  providerRef?: string | null;
  publishedAt?: number | null;
};

export type SinceContact = { createdAt: number };

export type SinceDeployment = {
  state: string;
  finishedAt?: number | null;
  updatedAt: number;
};

export type SinceLastVisitInput = {
  since: number;
  /** null when the plan does not include the module (locked). */
  posts: SincePost[] | null;
  contacts: SinceContact[] | null;
  /** The confirmed live deployment(s), or null when Build is locked. */
  deployments: SinceDeployment[] | null;
};

export type SinceLastVisitSummary = {
  since: number;
  posted?: number;
  newContacts?: number;
  websiteWentLive?: boolean;
};

export function isReceiptBackedPost(post: SincePost, since: number): boolean {
  return (
    post.status === "published" &&
    typeof post.providerRef === "string" &&
    post.providerRef.trim().length > 0 &&
    typeof post.publishedAt === "number" &&
    post.publishedAt > since
  );
}

export function summarizeSinceLastVisit(
  input: SinceLastVisitInput,
): SinceLastVisitSummary | null {
  const { since } = input;
  const summary: SinceLastVisitSummary = { since };
  let changed = false;

  if (input.posts) {
    const posted = input.posts.filter((p) => isReceiptBackedPost(p, since)).length;
    if (posted > 0) {
      summary.posted = posted;
      changed = true;
    }
  }
  if (input.contacts) {
    const newContacts = input.contacts.filter((c) => c.createdAt > since).length;
    if (newContacts > 0) {
      summary.newContacts = newContacts;
      changed = true;
    }
  }
  if (input.deployments) {
    const wentLive = input.deployments.some(
      (d) => d.state === "succeeded" && (d.finishedAt ?? d.updatedAt) > since,
    );
    if (wentLive) {
      summary.websiteWentLive = true;
      changed = true;
    }
  }
  return changed ? summary : null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Plain-language lines; "went out" / "live" come only from receipts. */
export function sinceLines(summary: SinceLastVisitSummary): string[] {
  const lines: string[] = [];
  if (summary.posted) lines.push(`${plural(summary.posted, "post", "posts")} went out`);
  if (summary.newContacts)
    lines.push(plural(summary.newContacts, "new contact", "new contacts"));
  if (summary.websiteWentLive) lines.push("Your website is live");
  return lines;
}
