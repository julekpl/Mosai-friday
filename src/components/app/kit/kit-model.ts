/**
 * Starter kit screen — the pure mapping from server state to what each card
 * says (docs/ux/first-run-blueprint.md §3 and §7). No React here, so the
 * five card states and the draft-vs-live wording are unit-tested directly.
 *
 * Truth rule (AGENTS.md §5.5): nothing here ever says "live", "published",
 * "sent" or "scheduled" unless the server said so. A finished website part is
 * a draft; only `siteHosting.status` reporting `live` shows an address.
 */

import { NEEDS_PLAN_CODE, NEEDS_PLAN_MESSAGE } from "@/shared/starterKitJob";
import type { StarterKitPart, StarterKitPartName } from "@/shared/starterKit";

/** The five card states of blueprint §3 (`locked` is derived, never stored). */
export type KitCardState = "working" | "succeeded" | "partially_succeeded" | "failed" | "locked";

/** Plain words for each part, as the owner reads them. */
export const PART_NOUN: Record<StarterKitPartName, string> = {
  plan: "plan",
  site: "website",
  posts: "posts",
};

export const PART_TITLE: Record<StarterKitPartName, string> = {
  plan: "Your plan",
  site: "Your website",
  posts: "Your posts",
};

/** Card order on screen and in announcements. */
export const KIT_PART_ORDER: readonly StarterKitPartName[] = ["plan", "site", "posts"];

export function cardState(part: Pick<StarterKitPart, "status" | "errorCode">): KitCardState {
  switch (part.status) {
    case "queued":
      return part.errorCode === NEEDS_PLAN_CODE ? "locked" : "working";
    case "running":
      return "working";
    case "succeeded":
      return "succeeded";
    case "partially_succeeded":
      return "partially_succeeded";
    // A canceled part did not produce its draft; it retries like a failure.
    case "failed":
    case "canceled":
      return "failed";
  }
}

/**
 * The label inside the card's `StatusBadge`. Plain words, and a finished
 * part is a "draft": never "live" or "published".
 */
export const BADGE_LABEL: Record<KitCardState, string> = {
  working: "drafting",
  succeeded: "draft",
  partially_succeeded: "needs_a_fix",
  failed: "failed",
  locked: "locked",
};

export type KitCardCopy = {
  state: KitCardState;
  badge: string;
  /** The card's main line. */
  headline: string;
  /** Second line: the job's real step, the named gap, or nothing. */
  detail?: string;
};

/** What a card says for a part (blueprint §3 table). */
export function kitCardCopy(
  name: StarterKitPartName,
  part: Pick<StarterKitPart, "status" | "errorCode" | "step" | "message">,
): KitCardCopy {
  const state = cardState(part);
  const noun = PART_NOUN[name];
  const badge = BADGE_LABEL[state];
  switch (state) {
    case "working":
      return {
        state,
        badge,
        headline: `Drafting your ${noun}…`,
        // Only the step the server job wrote: no fake timer or percentage.
        ...(part.step?.trim() ? { detail: part.step.trim() } : {}),
      };
    case "succeeded":
      return { state, badge, headline: readyLine(name) };
    case "partially_succeeded":
      return {
        state,
        badge,
        headline: readyLine(name),
        ...(part.message?.trim() ? { detail: part.message.trim() } : {}),
      };
    case "failed":
      return {
        state,
        badge,
        headline: `We could not draft your ${noun}. Your answers are saved.`,
      };
    case "locked":
      return { state, badge, headline: NEEDS_PLAN_MESSAGE };
  }
}

function readyLine(name: StarterKitPartName): string {
  switch (name) {
    case "plan":
      return "Your plan is ready";
    case "site":
      return "Your website draft is ready";
    case "posts":
      return "Your posts are ready to use";
  }
}

/**
 * The polite live-region line for a part that reached a finished state, or
 * null while it is still working or locked (nothing new to announce).
 */
export function kitAnnouncement(
  name: StarterKitPartName,
  part: Pick<StarterKitPart, "status" | "errorCode" | "message">,
): string | null {
  const state = cardState(part);
  const noun = PART_NOUN[name];
  switch (state) {
    case "succeeded":
      return `${readyLine(name)}.`;
    case "partially_succeeded":
      return part.message?.trim()
        ? `${readyLine(name)}, with one gap: ${part.message.trim()}`
        : `${readyLine(name)}, with one gap.`;
    case "failed":
      return `We could not draft your ${noun}. Your answers are saved.`;
    default:
      return null;
  }
}

/** The one fix button for a partial part (it opens where the gap is fixed). */
export const PARTIAL_FIX_LABEL: Record<StarterKitPartName, string> = {
  plan: "Fix the facts",
  site: "Fix it in Build",
  posts: "Add your own pictures",
};

/* ── Website address: shown only when the server reports `live` ────────── */

export type SiteHostingSnapshot = {
  state: "not_deployed" | "deploying" | "live" | "failed";
  path: string | null;
};

const PUBLIC_PATH = /^\/s\/[a-z0-9][a-z0-9-]*-website(?:\/[A-Za-z0-9._~/-]*)?$/;

/**
 * The public address of the website, or null. Null unless `siteHosting.status`
 * says `live` AND the address is a same-origin public-site path or an `https:`
 * URL, so a draft never shows an address.
 */
export function liveSiteAddress(
  hosting: SiteHostingSnapshot | null | undefined,
  origin: string,
): string | null {
  if (!hosting || hosting.state !== "live" || !hosting.path) return null;
  const path = hosting.path;
  if (PUBLIC_PATH.test(path) && !path.includes("..")) {
    return `${origin.replace(/\/+$/, "")}${path}`;
  }
  try {
    const url = new URL(path);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export const DRAFT_SITE_LINE = "Draft · not on the web yet";

/** Only `https:` URLs from the server become links or pictures. */
export function httpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Channel names as the owner knows them. */
export function channelLabel(channel: string): string {
  switch (channel) {
    case "facebook":
      return "Facebook";
    case "instagram":
      return "Instagram";
    case "linkedin":
      return "LinkedIn";
    case "x":
      return "X";
    default:
      return channel.charAt(0).toUpperCase() + channel.slice(1);
  }
}

export const MAX_KIT_POSTS = 7;
