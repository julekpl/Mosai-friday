/**
 * Home "For you now" (HM-1; docs/integration/2026-09-25/MVP-BLUEPRINT-PLAN.md
 * §2 row 6, §5). A pure ranking of at most 3 items from plain, already
 * server-verified inputs: starter kit status, business-profile completeness,
 * posts drafted/missing pictures, whether the website is confirmed live, and
 * the "since you were away" summary (`shared/sinceLastVisit.ts`).
 *
 * Priority ladder (kept in the same order as
 * `components/app/next-action-model.ts`'s outcome ladder — website, then
 * posts, then "a way to reach you" — so the two surfaces never disagree
 * about what matters most):
 *
 *   1. Kit still running        -> one "working" item, nothing else.
 *   2. Needs you (at most one)  -> a stuck kit part, missing post pictures,
 *                                   or an incomplete business profile.
 *   3. Ready for you            -> a finished website draft, then finished
 *                                   posts, each worth a look.
 *   4. Next                     -> the next thing beyond the kit's output
 *                                   (currently: add a way to be reached).
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

export type HomePrioritiesInput = {
  /** `null` when the project has no starter kit yet. */
  kit: HomePrioritiesKitInput | null;
  /** Build (website) module: whether it's on the plan and confirmed live. */
  build: { included: boolean; live: boolean };
  promote: { included: boolean };
  profile: {
    complete: boolean;
    /** One plain sentence naming the gap, when `complete` is false. */
    missingReason?: string;
  };
  /** A phone, email or address saved on the project. */
  contactable: boolean;
  posts: { drafted: number; missingPictures: number };
  since: SinceLastVisitSummary | null;
};

const MAX_ITEMS = 3;
const RUNNING_KIT_STATUSES: readonly StarterKitStatus[] = [
  "queued",
  "running",
  "waiting_for_user",
];
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

  // 1. Kit still running: one progress item, nothing else (plan §2 row 5).
  if (kit && RUNNING_KIT_STATUSES.includes(kit.status)) {
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
  } else if (
    kit &&
    kit.parts.posts.status === "partially_succeeded" &&
    posts.missingPictures > 0
  ) {
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
      reason: profile.missingReason ?? "A few details are missing, so drafts may be off.",
      action: { label: "Finish your details", to: "/app?edit=understanding" },
      state: "needs_input",
    });
  }

  // 3. Ready for you: finished kit output still worth a look, website first.
  const siteReady =
    !!kit &&
    build.included &&
    !build.live &&
    (kit.parts.site.status === "succeeded" || kit.parts.site.status === "partially_succeeded");
  if (siteReady) {
    items.push({
      id: "ready-site",
      kind: "ready",
      title: "Look over your website",
      reason: "Your website draft is ready to look over.",
      action: { label: "Look over your website", to: "/app/build" },
      state: "ready",
    });
  }

  const postsReady =
    !!kit &&
    promote.included &&
    posts.drafted > 0 &&
    posts.missingPictures === 0 &&
    (kit.parts.posts.status === "succeeded" || kit.parts.posts.status === "partially_succeeded");
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

  // 4. Next: the one thing left once the kit's own output is handled.
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
