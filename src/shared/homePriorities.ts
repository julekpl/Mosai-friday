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
 *                                    owner, missing post pictures, or
 *                                    "Your answers" still incomplete.
 *   3. Website                   -> ready to look over (draft), or the next
 *                                    step to get one (kit ran but has none).
 *   4. Posts                     -> ready to use.
 *   5. No kit and nothing above  -> "Start your kit".
 *   6. A way to reach you        -> when none is saved.
 *
 * Goal and channel aware (HM-2): when the owner's main goal is about being
 * known or coming back (`awareness`, `repeat_customers`), ready posts rank
 * above the ready website; every other goal keeps the website first. The
 * "Why this?" line names the goal. Post items are only ranked when the owner
 * posts somewhere: an answered-but-empty `postingChannels` (or only "Nowhere
 * yet") drops them; an unanswered one (`undefined`, older projects) keeps
 * them.
 *
 * KIT-F1: a free owner whose kit parts wait for Starter gets one "Try
 * Starter" item (or "Get Starter" once the account's one trial is used) in
 * the "needs you" slot instead of a kit that silently waits.
 *
 * Truth rules (AGENTS.md §5): nothing here upgrades a draft to "live"; a
 * website only drops off the "ready" list once the caller reports it is
 * confirmed live by a real deployment receipt. No numeric score is exposed;
 * ranking is fixed rule order, not a computed number.
 */

import {
  CHANNEL_LABELS,
  type PostingChannel,
  type PrimaryGoal,
  type StarterKitPartStatus,
  type StarterKitStatus,
} from "./starterKit";
import type { SinceLastVisitSummary } from "./sinceLastVisit";

export type HomePriorityKind = "needs_you" | "ready" | "next";
export type HomePriorityState = "ready" | "needs_input" | "working";

export type HomeKitPartName = "plan" | "site" | "posts";

/** What the item's button does. Server-resolved, never a client guess.
 *  `link` navigates to a different route (never Home itself, which is where
 *  this list is shown); `intent` asks the Home page to act in place. */
export type HomePriorityAction =
  | { kind: "link"; label: string; to: string }
  | {
      kind: "intent";
      label: string;
      intent: "show_kit_progress" | "start_kit" | "open_kit";
    }
  | { kind: "intent"; label: string; intent: "retry_kit_part"; part: HomeKitPartName };

export type HomePriorityItem = {
  id: string;
  kind: HomePriorityKind;
  title: string;
  /** One plain sentence for the "Why this?" disclosure. */
  reason: string;
  action: HomePriorityAction;
  state: HomePriorityState;
};

export type HomeKitPartInput = {
  status: StarterKitPartStatus;
  /** Waiting for a plan that includes it (`needs_plan`), not failed. */
  locked?: boolean;
};

/** KIT-F1: the organization's plan, as the server resolved it. */
export type HomePlanInput = {
  free: boolean;
  /** The account has never had its one trial (webhook-set marker). */
  trialAvailable: boolean;
};

/** Plan options live at the workspace-level billing route. */
export const PLANS_ROUTE = "/app/billing";

export type HomePrioritiesKitInput = {
  status: StarterKitStatus;
  /** Queued or running but untouched for too long (`isStaleKit`): its run
   *  died, so it is not "building" any more and "Try again" resumes it. */
  stale?: boolean;
  parts: { plan: HomeKitPartInput; site: HomeKitPartInput; posts: HomeKitPartInput };
};

/** Mirrors `next-action-model.ts`'s `WebsiteState`: "live" only from a
 *  confirmed hosting receipt, everything else a draft or nothing yet. */
export type HomeWebsiteState = "none" | "draft" | "live";

export type HomePrioritiesInput = {
  /** The project the list is for; links are real routes under it. */
  projectId: string;
  /** `null` when the project has no starter kit yet. */
  kit: HomePrioritiesKitInput | null;
  build: { included: boolean; website: HomeWebsiteState };
  promote: { included: boolean };
  profile: { complete: boolean };
  /** A phone, email or address saved on the project. */
  contactable: boolean;
  posts: { drafted: number; missingPictures: number };
  since: SinceLastVisitSummary | null;
  /** The owner's main goal from "Your answers", if any. */
  primaryGoal?: PrimaryGoal;
  /** Where the owner posts. `undefined` = never answered. */
  postingChannels?: readonly PostingChannel[];
  /** `undefined` = unknown; no plan item is shown. */
  plan?: HomePlanInput;
};

const MAX_ITEMS = 3;
/** A kit still actively drafting. `waiting_for_user` is not here: the owner
 *  must act, so it is a "needs you" item, not a silent progress bar. */
const ACTIVE_KIT_STATUSES: readonly StarterKitStatus[] = ["queued", "running"];
const ACTIVE_PART_STATUSES: readonly StarterKitPartStatus[] = ["queued", "running"];
const STUCK_PART_STATUSES: readonly StarterKitPartStatus[] = ["failed", "canceled"];

const PART_NOUN: Record<"plan" | "site" | "posts", string> = {
  plan: "plan",
  site: "website",
  posts: "posts",
};
const KIT_PART_ORDER: readonly HomeKitPartName[] = ["plan", "site", "posts"];

/** Goals where posts matter more this week than the website. */
const POSTS_FIRST_GOALS: readonly PrimaryGoal[] = ["awareness", "repeat_customers"];

/** The goal as the owner would say it ("You want ..."). */
const GOAL_WANT: Record<PrimaryGoal, string> = {
  bookings: "more bookings",
  sales: "more sales",
  online_orders: "more online orders",
  visits: "more people through the door",
  awareness: "to get known locally",
  repeat_customers: "more repeat customers",
  reviews: "better reviews",
};

function realChannels(channels: readonly PostingChannel[] | undefined): PostingChannel[] | undefined {
  return channels?.filter((channel) => channel !== "none");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function sincePostsNote(since: SinceLastVisitSummary | null): string | undefined {
  if (!since?.posted) return undefined;
  return `${plural(since.posted, "post", "posts")} went out since your last visit.`;
}

/** The at-most-3-item ranked list for "For you now". */
export function rankHomePriorities(input: HomePrioritiesInput): HomePriorityItem[] {
  const { kit, build, promote, profile, contactable, posts, since, primaryGoal } = input;
  const home = `/app/${input.projectId}`;
  const channels = realChannels(input.postingChannels);
  // Answered with no channel ("Nowhere yet", or nothing): no post items.
  const postsWanted = channels === undefined || channels.length > 0;
  const goalWant = primaryGoal ? GOAL_WANT[primaryGoal] : undefined;

  // 1. Kit actively drafting: one progress item, nothing else (plan §2 row 5).
  const kitActive = !!kit && ACTIVE_KIT_STATUSES.includes(kit.status);
  if (kit && kitActive && !kit.stale) {
    return [
      {
        id: "kit-working",
        kind: "next",
        title: "Building your starter kit",
        reason: "MOSAI is drafting your plan, website and posts from what you told us.",
        action: { kind: "intent", label: "Watch it build", intent: "show_kit_progress" },
        state: "working",
      },
    ];
  }

  const items: HomePriorityItem[] = [];

  // 2. Needs you: at most one, most urgent gap first. A stale kit's first
  //    unfinished part counts as stuck: its run stopped.
  const stalled = kitActive && !!kit?.stale;
  const stuckPart = kit
    ? KIT_PART_ORDER.find((name) =>
        stalled
          ? ACTIVE_PART_STATUSES.includes(kit.parts[name].status)
          : STUCK_PART_STATUSES.includes(kit.parts[name].status),
      )
    : undefined;
  const lockedParts = kit ? KIT_PART_ORDER.filter((name) => kit.parts[name].locked === true) : [];
  if (stuckPart) {
    items.push({
      id: `needs-you-${stuckPart}`,
      kind: "needs_you",
      title: stalled
        ? `Your ${PART_NOUN[stuckPart]} is not finished yet`
        : `We could not draft your ${PART_NOUN[stuckPart]}`,
      reason: stalled
        ? "MOSAI stopped before it finished. Your answers are kept."
        : "Something went wrong while MOSAI worked on it. Your answers are kept.",
      action: { kind: "intent", label: "Try again", intent: "retry_kit_part", part: stuckPart },
      state: "needs_input",
    });
  } else if (kit && input.plan?.free && lockedParts.length > 0) {
    // KIT-F1: a free owner's kit parts wait for Starter. Never a dead end:
    // one item says what is locked and where to get it (the trial needs a
    // card; checkout offers it once per account).
    const nouns = lockedParts.map((name) => PART_NOUN[name]);
    const list = nouns.length > 1 ? `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}` : nouns[0];
    const trial = input.plan.trialAvailable;
    items.push({
      id: "next-try-starter",
      kind: "next",
      title: trial ? "Try Starter" : "Get Starter",
      reason: `Your ${list} ${lockedParts.length > 1 || lockedParts[0] === "posts" ? "need" : "needs"} Starter.${
        trial ? " The free trial asks for a card." : ""
      }`,
      action: { kind: "link", label: trial ? "Try Starter" : "See plans", to: PLANS_ROUTE },
      state: "ready",
    });
  } else if (kit && kit.status === "waiting_for_user") {
    items.push({
      id: "needs-you-kit",
      kind: "needs_you",
      title: "Your starter kit needs something from you",
      reason: "MOSAI needs one more thing from you before it can keep drafting.",
      action: { kind: "intent", label: "Open your kit", intent: "open_kit" },
      state: "needs_input",
    });
  } else if (promote.included && postsWanted && posts.missingPictures > 0) {
    items.push({
      id: "needs-you-pictures",
      kind: "needs_you",
      title: "Add pictures to your posts",
      reason: `${plural(posts.missingPictures, "post needs", "posts need")} a picture.`,
      action: { kind: "link", label: "Add pictures", to: `${home}/promote` },
      state: "needs_input",
    });
  } else if (!profile.complete) {
    items.push({
      id: "needs-you-profile",
      kind: "needs_you",
      title: "Check your answers",
      reason: "A few answers about your business are missing, so drafts may be off.",
      // "Your answers" lives on Edit project's "Your business" tab (#27).
      action: { kind: "link", label: "Open your answers", to: `${home}?edit=understanding` },
      state: "needs_input",
    });
  }

  // 3. Website: ready to look over, or the next step to get one. Holds with
  //    or without a kit — Build works on its own too.
  const outcomes: HomePriorityItem[] = [];
  const websiteReady = build.included && build.website === "draft";
  if (websiteReady) {
    outcomes.push({
      id: "ready-site",
      kind: "ready",
      title: "Look over your website",
      reason: goalWant
        ? `You want ${goalWant}, and your website draft is ready to look over.`
        : "Your website draft is ready to look over.",
      action: { kind: "link", label: "Look over your website", to: `${home}/build` },
      state: "ready",
    });
  } else if (build.included && build.website === "none" && kit) {
    // A kit ran (or is finishing) but produced no website — a real gap, not
    // just "hasn't started yet" (that case is `kit === null`, handled below).
    outcomes.push({
      id: "next-website",
      kind: "next",
      title: "Make your website",
      reason: "Start from your business details. It stays a draft until you publish it.",
      action: { kind: "link", label: "Make your website", to: `${home}/build` },
      state: "ready",
    });
  }

  // 4. Posts: ready to use, only where the owner posts. Holds with or
  //    without a kit.
  const postsReady =
    promote.included && postsWanted && posts.drafted > 0 && posts.missingPictures === 0;
  if (postsReady) {
    const sinceNote = sincePostsNote(since);
    const where = channels?.length
      ? ` for ${channels.map((channel) => CHANNEL_LABELS[channel]).join(", ")}`
      : "";
    outcomes.push({
      id: "ready-posts",
      kind: "ready",
      title: "Use this week's posts",
      reason: sinceNote
        ? `${sinceNote} ${plural(posts.drafted, "more is", "more are")} ready to use${where}.`
        : `${plural(posts.drafted, "post is", "posts are")} ready to use${where}.`,
      action: { kind: "link", label: "Review your posts", to: `${home}/promote` },
      state: "ready",
    });
  }

  // Goal order: posts first for awareness and repeat customers.
  if (primaryGoal && POSTS_FIRST_GOALS.includes(primaryGoal)) outcomes.reverse();
  items.push(...outcomes);

  // 5. No kit yet, and nothing above already gives the owner something to
  //    look over: starting the kit is the single most useful next step, so a
  //    brand-new (or kit-less) project never lands on an empty list.
  if (!kit && !websiteReady && !postsReady) {
    items.push({
      id: "next-start-kit",
      kind: "next",
      title: "Start your kit",
      reason: "MOSAI drafts a plan, a website and posts from your business details in one go.",
      action: { kind: "intent", label: "Start your kit", intent: "start_kit" },
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
      action: { kind: "link", label: "Add contact details", to: `${home}?edit=details` },
      state: "ready",
    });
  }

  return items.slice(0, MAX_ITEMS);
}
