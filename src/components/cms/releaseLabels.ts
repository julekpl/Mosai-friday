/**
 * Honest display wording for local release states (AGENTS.md rule 5).
 *
 * CMS pages and page revisions store `release_prepared` when a release is
 * PREPARED (owner decision, 24 Sep 2026). Rows written before that rename
 * still say `published` (and legacy site rows `live`) until the
 * `cmsReleaseMigration` has run. Nothing is served publicly until a verified
 * deployment receipt exists (`lib/deliveryGate.ts`), so the UI must not
 * repeat those words. These helpers accept both spellings and translate them
 * into wording that claims no more than the server knows.
 *
 * Return values are status keys (snake_case) so `StatusBadge` can render them.
 */

/** Toast after a page release is prepared (`cms.publishPage`). */
export const RELEASE_PREPARED_MESSAGE =
  "This version is prepared for release. It is not publicly served yet. Earlier versions stay in History.";

/** Description in the page "Prepare release" dialog. */
export const RELEASE_DIALOG_MESSAGE =
  "This promotes the draft to the page's release version. Nothing is publicly served until hosting is set up. The previous version stays recoverable.";

/** True for a page status or revision state that marks a prepared release,
 *  under its current name (`release_prepared`) or the legacy `published`. */
export function isReleasePrepared(status: string): boolean {
  return status === "release_prepared" || status === "published";
}

/** A CMS page status as shown to the user. */
export function pageStatusForDisplay(status: string): string {
  return isReleasePrepared(status) ? "prepared_for_release" : status;
}

/** A page revision state as shown in version history. */
export function revisionStateForDisplay(state: string): string {
  return isReleasePrepared(state) ? "latest_release" : state;
}

/** A site or build status as shown to the user. `live` and `published`
 *  were written by older code without a deployment receipt. */
export function siteStatusForDisplay(status: string): string {
  return status === "live" || status === "published" ? "prepared_for_release" : status;
}

/** Human text for a status key, e.g. `latest_release` → `latest release`. */
export function statusText(status: string): string {
  return status.replace(/_/g, " ");
}
