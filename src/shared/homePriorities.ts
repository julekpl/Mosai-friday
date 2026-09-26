/**
 * Home "For you now" (HM-1; docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md
 * §2 row 6, §5). A pure ranking of at most 3 items from plain, already
 * server-verified inputs: starter kit status (or its absence), the website's
 * state (`components/app/next-action-model.ts`'s `WebsiteState`, kept as its
 * own copy so the backend never imports from the UI layer, AGENTS.md §10),
 * business-profile completeness, posts drafted/missing pictures, and the
 * "since you were away" summary (`shared/sinceLastVisit.ts`).
 *
 * Priority ladder (kept in the same order as `next-action-model.ts`'s
 * outcome ladder — website, then posts, then "a way to reach you" — so the
 * two surfaces never disagree about what matters most). This ladder holds
 * whether or not a starter kit ever ran: a project can reach a draft website
 * or draft posts without one (Build/Promote used directly), and a project
 * with no kit and nothing else to show gets one "Start your kit" item
 * instead of an empty list:
 *
 *   1. Kit actively drafting     -> one "working" item, nothing else.
 *   2. Needs you (at most one)   -> a stuck kit part, a kit waiting on the
 *                                    owner, missing post pictures, or an
 *                                    incomplete business profile.
 *   3. Website                   -> ready to look over (draft), or the next
 *                                    step to get one (kit ran but has none).
 *   4. Posts                     -> ready to use.
 *   5. No kit and nothing above  -> "Start your kit".
 *   6. A way to reach you        -> when none is saved.
 *
 * Truth rules (AGENTS.md §5): nothing here upgrades a draft to "live"; a
 * website only drops off the "ready" list once the caller reports it is
 * confirmed live by a real deployment receipt. No numeric score is exposed;
 * ranking is fixed rule order, not a computed number.
 */

import type { StarterKitPartStatus, StarterKitStatus } from "./starterKit";
import type { SinceLastVisitSummary } from "./sinceLastVisit";

export type HomePriorityKind = "needs_you" | "ready" | "next";
export type HomePriorityState = "ready" | "needs_input" | "working";

/** Route the item's button opens. Server-resolved, never a client guess. */
export type HomePriorityAction = { label: string; to: string };

export type HomePriorityItem = {
  id: string;
  kind: HomePriorityKind;
  title: string;
  /** One plain sentence for the "Why this?" disclosure. */
  reason: string;
  action: HomePriorityAction;
  state: HomePriorityState;
};

export type HomeKitPartInput = { status: StarterKitPartStatus };

export type HomePrioritiesKitInput = {
  status: StarterKitStatus;
  parts: { plan: HomeKitPartInput; site: HomeKitPartInput; posts: HomeKitPartInput };
};

/** Mirrors `next-action-model.ts`'s `WebsiteState`: "live" only from a
 *  confirmed hosting receipt, everything else a draft or nothing yet. */
export type HomeWebsiteState = "none" | "draft" | "live";

export type HomePrioritiesInput = {
  /** `null` when the project has no starter kit yet. */
  kit: HomePrioritiesKitInput | null;
  build: { included: boolean; website: HomeWebsiteState };
  promote: { included: boolean };
  profile: { complete: boolean };
  /** A phone, email or address saved on the project. */
  contactable: boolean;
  posts: { drafted: number; missingPictures: number };
  since: SinceLastVisitSummary | null;
};

const MAX_ITEMS = 3;
/** A kit still actively drafting. `waiting_for_user` is not here: the owner
 *  must act, so it is a "needs you" item, not a silent progress bar. */
const ACTIVE_KIT_STATUSES: readonly StarterKitStatus[] = ["queued", "running"];
const STUCK_PART_STATUSES: readonly StarterKitPartStatus[] = ["failed", "canceled"];

const PART_NOUN: Record<"plan" | "site" | "posts", string> = {
  plan: "plan",
  site: "website",
  posts: "posts",
};
const PART_ROUTE: Record<"plan" | "site" | "posts", string> = {
  plan: "/app/create",
  site: "/app/build",
  posts: "/app/promote",
};
const KIT_PART_ORDER: readonly ("plan" | "site" | "posts")[] = ["plan", "site", "posts"];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sincePostsNote(since: SinceLastVisitSummary | null): string | undefined {
  if (!since?.posted) return undefined;
  return `${plural(since.posted, "post", "posts")} went out since your last visit.`;
}

/** The at-most-3-item ranked list for "For you now". */
export function rankHomePriorities(input: HomePrioritiesInput): HomePriorityItem[] {
  const { kit, build, promote, profile, contactable, posts, since } = input;

  // 1. Kit actively drafting: one progress item, nothing else (plan §2 row 5).
  if (kit && ACTIVE_KIT_STATUSES.includes(kit.status)) {
    return [
      {
        id: "kit-working",
        kind: "next",
        title: "Building your starter kit",
        reason: "MOSAI is drafting your plan, website and posts from what you told us.",
        action: { label: "Watch it build", to: "/app" },
        state: "working",
      },
    ];
  }

  const items: HomePriorityItem[] = [];

  // 2. Needs you: at most one, most urgent gap first.
  const stuckPart = kit
    ? KIT_PART_ORDER.find((name) => STUCK_PART_STATUSES.includes(kit.parts[name].status))
    : undefined;
  if (stuckPart) {
    items.push({
      id: `needs-you-${stuckPart}`,
      kind: "needs_you",
      title: `We could not draft your ${PART_NOUN[stuckPart]}`,
      reason: "Something went wrong while MOSAI worked on it. Your answers are kept.",
      action: { label: "Try again", to: PART_ROUTE[stuckPart] },
      state: "needs_input",
    });
  } else if (kit && kit.status === "waiting_for_user") {
    items.push({
      id: "needs-you-kit",
      kind: "needs_you",
      title: "Your starter kit needs something from you",
      reason: "MOSAI needs one more thing from you before it can keep drafting.",
      action: { label: "Open your kit", to: "/app" },
      state: "needs_input",
    });
  } else if (promote.included && posts.missingPictures > 0) {
    items.push({
      id: "needs-you-pictures",
      kind: "needs_you",
      title: "Add pictures to your posts",
      reason: `${plural(posts.missingPictures, "post needs", "posts need")} a picture.`,
      action: { label: "Add pictures", to: "/app/promote" },
      state: "needs_input",
    });
  } else if (!profile.complete) {
    items.push({
      id: "needs-you-profile",
      kind: "needs_you",
      title: "Finish your business details",
      reason: "A few details are missing, so drafts may be off.",
      action: { label: "Finish your details", to: "/app?edit=understanding" },
      state: "needs_input",
    });
  }

  // 3. Website: ready to look over, or the next step to get one. Holds with
  //    or without a kit — Build works on its own too.
  const websiteReady = build.included && build.website === "draft";
  if (websiteReady) {
    items.push({
      id: "ready-site",
      kind: "ready",
      title: "Look over your website",
      reason: "Your website draft is ready to look over.",
      action: { label: "Look over your website", to: "/app/build" },
      state: "ready",
    });
  } else if (build.included && build.website === "none" && kit) {
    // A kit ran (or is finishing) but produced no website — a real gap, not
    // just "hasn't started yet" (that case is `kit === null`, handled below).
    items.push({
      id: "next-website",
      kind: "next",
      title: "Make your website",
      reason: "Start from your business details. It stays a draft until you publish it.",
      action: { label: "Make your website", to: "/app/build" },
      state: "ready",
    });
  }

  // 4. Posts: ready to use. Holds with or without a kit.
  const postsReady = promote.included && posts.drafted > 0 && posts.missingPictures === 0;
  if (postsReady) {
    const sinceNote = sincePostsNote(since);
    items.push({
      id: "ready-posts",
      kind: "ready",
      title: "Use this week's posts",
      reason: sinceNote
        ? `${sinceNote} ${plural(posts.drafted, "more is", "more are")} ready to use.`
        : `${plural(posts.drafted, "post is", "posts are")} ready to use.`,
      action: { label: "Review your posts", to: "/app/promote" },
      state: "ready",
    });
  }

  // 5. No kit yet, and nothing above already gives the owner something to
  //    look over: starting the kit is the single most useful next step, so a
  //    brand-new (or kit-less) project never lands on an empty list.
  if (!kit && !websiteReady && !postsReady) {
    items.push({
      id: "next-start-kit",
      kind: "next",
      title: "Start your kit",
      reason: "MOSAI drafts a plan, a website and posts from your business details in one go.",
      action: { label: "Start your kit", to: "/app" },
      state: "ready",
    });
  }

  // 6. A way to reach you.
  if (!contactable) {
    items.push({
      id: "next-contact",
      kind: "next",
      title: "Add a way to reach you",
      reason: "Save a phone, email or address so customers can reach you.",
      action: { label: "Add contact details", to: "/app?edit=details" },
      state: "ready",
    });
  }

  return items.slice(0, MAX_ITEMS);
}
