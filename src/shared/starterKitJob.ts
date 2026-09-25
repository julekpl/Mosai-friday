/**
 * Starter kit job — pure helpers (ticket U3, docs/ux/first-run-blueprint.md
 * §3, §4 and §6).
 *
 * No database access and no Convex runtime imports, so the job
 * (`src/convex/starterKit.ts`) and the unit tests read the same rules: the
 * kit's status reduction, what a retry resets, the budget, the model output
 * contracts and the website's main-button rule.
 */

import type {
  BusinessType,
  PostingChannel,
  PrimaryGoal,
  StarterKitPart,
  StarterKitPartName,
  StarterKitStatus,
} from "./starterKit";

/** Hard AI cost cap for one kit, in integer micro-USD (US$0.40). Flagged for
 *  the owner to confirm (AGENTS.md §7: money). */
export const STARTER_KIT_BUDGET_MICROUSD = 400_000;

/** Booked when the provider reports no cost for a call: a conservative
 *  estimate (US$0.05) so an unknown cost never reads as free. */
export const STARTER_KIT_UNKNOWN_CALL_MICROUSD = 50_000;

/** A part the kit could not run because the plan does not include it. */
export const NEEDS_PLAN_CODE = "needs_plan";
export const NEEDS_PLAN_MESSAGE = "Needs the Starter plan";

/** The real steps the server job is on (blueprint §3: no fake timers). */
export const STARTER_KIT_STEPS = {
  reading: "Reading your website",
  plan: "Writing your plan",
  site: "Writing your homepage",
  posts: "Writing your posts",
  pictures: "Finding pictures for your posts",
} as const;

export const STARTER_KIT_POST_COUNT = 7;

/** Posts are text drafts; TikTok needs a video, so it is not offered here. */
export const STARTER_KIT_POST_CHANNELS = ["facebook", "instagram", "linkedin", "x"] as const;
export type StarterKitPostChannel = (typeof STARTER_KIT_POST_CHANNELS)[number];

export type StarterKitParts = Record<StarterKitPartName, StarterKitPart>;

export function isNeedsPlan(part: StarterKitPart): boolean {
  return part.status === "queued" && part.errorCode === NEEDS_PLAN_CODE;
}

/**
 * The kit's status from its parts. Returns `running` while any part is still
 * queued for work or running (another run of the same kit may still be
 * working on it), so only a finished kit gets a terminal state.
 */
export function reduceStarterKitStatus(parts: StarterKitParts): StarterKitStatus {
  const list = Object.values(parts);
  if (list.every((part) => part.status === "succeeded")) return "succeeded";
  if (list.some((part) => part.status === "running" || (part.status === "queued" && !isNeedsPlan(part)))) {
    return "running";
  }
  if (list.some(isNeedsPlan)) return "waiting_for_user";
  const anyWorked = list.some(
    (part) => part.status === "succeeded" || part.status === "partially_succeeded",
  );
  if (!anyWorked && list.some((part) => part.status === "failed")) return "failed";
  return "partially_succeeded";
}

/** Kit states where "Try again" resumes the parts that did not finish. */
export function isRetryableKitStatus(status: StarterKitStatus): boolean {
  return status === "failed" || status === "partially_succeeded" || status === "waiting_for_user";
}

/**
 * A kit left `queued` or `running` with no progress for this long is dead: a
 * Convex action is stopped after 10 minutes, so no run can still be working
 * on it. `start` then resumes it instead of waiting forever.
 */
export const STARTER_KIT_STALE_MS = 15 * 60_000;

export function isStaleKit(kit: { status: StarterKitStatus; updatedAt: number }, now: number): boolean {
  return (kit.status === "queued" || kit.status === "running") && now - kit.updatedAt > STARTER_KIT_STALE_MS;
}

/**
 * The parts after "Try again": failed parts and parts waiting for a plan go
 * back to `queued` with their error cleared; every other part (and its
 * outputs) is returned untouched.
 */
export function resetPartsForRetry(parts: StarterKitParts, now: number): StarterKitParts {
  const reset = (part: StarterKitPart): StarterKitPart => {
    // A part still "running" here belongs to a dead run (see isStaleKit).
    if (part.status !== "failed" && part.status !== "running" && !isNeedsPlan(part)) return part;
    return {
      status: "queued",
      outputs: part.outputs,
      attempts: part.attempts,
      updatedAt: now,
    };
  };
  return { plan: reset(parts.plan), site: reset(parts.site), posts: reset(parts.posts) };
}

/* ── Error mapping (plain words only; never a provider message) ─────────── */

export type StarterKitFailure = { errorCode: string; message: string };

const QUOTA_TEXT = "AI request limit reached";

export function starterKitFailure(
  error: unknown,
  isBudgetReached: (error: unknown) => boolean,
): StarterKitFailure {
  if (isBudgetReached(error)) return budgetFailure();
  const text = error instanceof Error ? error.message : "";
  if (text.includes(QUOTA_TEXT)) {
    return {
      errorCode: "rate_limited",
      message: "Too many AI requests in a short time. Wait a few minutes and try again.",
    };
  }
  return { errorCode: "ai_error", message: "We could not write this draft. Your answers are saved." };
}

export function budgetFailure(): StarterKitFailure {
  return {
    errorCode: "ai_budget",
    message: "The AI budget for your starter kit is used up, so this draft was not written.",
  };
}

/* ── Model output contracts ─────────────────────────────────────────────── */

function jsonObject(text: string): unknown {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start === -1) throw new Error("no JSON");
  const open = cleaned[start];
  const end = cleaned.lastIndexOf(open === "[" ? "]" : "}");
  if (end < start) throw new Error("no JSON");
  return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("missing text");
  return value.trim().slice(0, max);
}

function basis(value: unknown): "fact" | "assumption" {
  if (value !== "fact" && value !== "assumption") throw new Error("invalid basis");
  return value;
}

export type StarterKitPlan = {
  customers: Array<{ text: string; basis: "fact" | "assumption" }>;
  thisWeek: Array<{ action: string; why: string; basis: "fact" | "assumption" }>;
};

/** Parse and validate the plan reply; throws when it breaks the contract. */
export function parseStarterKitPlan(output: string): StarterKitPlan {
  const value = jsonObject(output);
  if (!isRecord(value) || !Array.isArray(value.customers) || !Array.isArray(value.thisWeek)) {
    throw new Error("invalid plan");
  }
  if (value.customers.length < 1 || value.customers.length > 6) throw new Error("invalid customers");
  if (value.thisWeek.length !== 3) throw new Error("the plan needs exactly 3 actions");
  return {
    customers: value.customers.map((item) => {
      if (!isRecord(item)) throw new Error("invalid customer");
      return { text: text(item.text, 300), basis: basis(item.basis) };
    }),
    thisWeek: value.thisWeek.map((item) => {
      if (!isRecord(item)) throw new Error("invalid action");
      return { action: text(item.action, 300), why: text(item.why, 400), basis: basis(item.basis) };
    }),
  };
}

export type StarterKitPostDraft = {
  channel: StarterKitPostChannel;
  body: string;
  /** 2-5 plain words for a stock photo search (U5b); absent when unusable. */
  imageQuery?: string;
};

/**
 * Validate the model's photo search words: letters, digits and spaces only,
 * 2-5 words, each at most 24 characters. Anything else gives no query (the
 * post then simply has no stock picture), never a failed part.
 */
export function parseImageQuery(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const words = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2 || words.length > 5) return undefined;
  if (words.some((word) => word.length > 24)) return undefined;
  return words.join(" ");
}

/** The posts part's outcome: succeeded only when every post has a picture;
 *  otherwise the message names the real gap. */
export function postsPictureSummary(
  total: number,
  withPictures: number,
): { status: "succeeded" | "partially_succeeded"; message: string } {
  if (total > 0 && withPictures >= total) {
    return { status: "succeeded", message: `${total} posts written, all with pictures.` };
  }
  return {
    status: "partially_succeeded",
    message: `${withPictures} of ${total} posts have pictures; add your own for the rest.`,
  };
}

/** Parse and validate the posts reply: exactly 7 posts on known channels. */
export function parseStarterKitPosts(
  output: string,
  allowed: readonly StarterKitPostChannel[] = STARTER_KIT_POST_CHANNELS,
): StarterKitPostDraft[] {
  const value = jsonObject(output);
  const list = isRecord(value) ? value.posts : value;
  if (!Array.isArray(list) || list.length !== STARTER_KIT_POST_COUNT) {
    throw new Error(`expected ${STARTER_KIT_POST_COUNT} posts`);
  }
  return list.map((item) => {
    if (!isRecord(item)) throw new Error("invalid post");
    const channel = item.channel;
    if (
      typeof channel !== "string" ||
      !(allowed as readonly string[]).includes(channel)
    ) {
      throw new Error("invalid channel");
    }
    const imageQuery = parseImageQuery(item.imageQuery);
    return {
      channel: channel as StarterKitPostChannel,
      body: text(item.body, 2_000),
      ...(imageQuery ? { imageQuery } : {}),
    };
  });
}

/* ── Website main button (blueprint §6) ─────────────────────────────────── */

export type StarterKitContact = {
  phone?: string;
  email?: string;
  address?: string;
  /** The owner's own website, used only for online-shop and events buttons. */
  website?: string;
};

export type MainButton = { label: string; href: string };

/** `tel:` link from a scanned phone number, or null when it is not one. */
export function telHref(phone: string | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 6 || digits.length > 15) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

export function mailtoHref(email: string | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  if (trimmed.length > 254 || !/^[^\s@<>"'()]+@[^\s@<>"'()]+\.[a-z]{2,}$/i.test(trimmed)) return null;
  return `mailto:${trimmed}`;
}

export function mapHref(address: string | undefined): string | null {
  const trimmed = address?.trim();
  if (!trimmed || trimmed.length > 300) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
}

/**
 * The site's main buttons by business type. Links are built on the server
 * from stored facts; the model may only use these. MOSAI stores no booking
 * link yet, so "Book" is not offered until one exists. The main type sets the
 * first buttons; each other type the owner picked adds its own first button
 * when it is a different link (at most three buttons).
 */
export function mainButtonsFor(
  type: BusinessType | undefined,
  contact: StarterKitContact,
  otherTypes: readonly BusinessType[] = [],
): MainButton[] {
  const buttons: MainButton[] = [];
  const main = buttonsForType(type, contact);
  for (const button of main) buttons.push(button);
  for (const other of otherTypes) {
    const first = buttonsForType(other, contact)[0];
    if (first && !buttons.some((button) => button.href === first.href)) buttons.push(first);
  }
  return buttons.slice(0, 3);
}

function buttonsForType(type: BusinessType | undefined, contact: StarterKitContact): MainButton[] {
  const call = telHref(contact.phone);
  const mail = mailtoHref(contact.email);
  const map = mapHref(contact.address);
  const site = websiteHref(contact.website);
  const buttons: MainButton[] = [];
  const add = (label: string, href: string | null) => {
    if (href && !buttons.some((button) => button.href === href)) buttons.push({ label, href });
  };
  switch (type) {
    case "walk_in":
    case "shop":
      add("Find us", map);
      add("Call", call);
      break;
    case "trades":
      add("Call", call);
      add("Get a quote", mail);
      break;
    case "online_shop":
      add("Shop online", site);
      add("Email", mail);
      break;
    case "events":
      add("See what's on", site);
      add("Call", call);
      break;
    default:
      add("Call", call);
      add("Email", mail);
      break;
  }
  // Never drop a known way to reach the owner: a type whose own buttons have
  // no link (no address, no website) falls back to Call and Email.
  if (!buttons.length) {
    add("Call", call);
    add("Email", mail);
  }
  return buttons;
}

/** The owner's own website as a button link: `https:` only. */
export function websiteHref(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The social channels the kit writes posts for: only where the owner already
 * posts and MOSAI can post. Google Business Profile and TikTok (video) are
 * not post targets yet. "Nowhere yet", or only unsupported channels, starts
 * them on Instagram and Facebook; a skipped question keeps the full mix.
 */
export function kitPostChannels(
  channels: readonly PostingChannel[] | undefined,
): StarterKitPostChannel[] {
  if (!channels?.length) return [...STARTER_KIT_POST_CHANNELS];
  const supported = STARTER_KIT_POST_CHANNELS.filter((channel) =>
    (channels as readonly string[]).includes(channel),
  );
  return supported.length ? supported : ["instagram", "facebook"];
}

const GOAL_WORDS: Record<PrimaryGoal, string> = {
  bookings: "get more bookings",
  sales: "sell more in store",
  online_orders: "get more online orders",
  visits: "get more people through the door",
  awareness: "become better known locally",
  repeat_customers: "get more repeat customers",
  reviews: "get more and better reviews",
};

const TYPE_WORDS: Record<BusinessType, string> = {
  appointments: "a business customers book appointments with",
  trades: "a trades or home services business",
  shop: "a shop customers can walk into",
  online_shop: "an online shop",
  walk_in: "a café, restaurant or bar customers walk into",
  professional: "a professional services firm",
  events: "a business that runs events, classes or experiences",
  agency: "an agency working for clients",
};

export function describeTypeAndGoal(
  type: BusinessType | undefined,
  goal: PrimaryGoal | undefined,
): string {
  return [
    `Business type: ${type ? TYPE_WORDS[type] : "not given"}.`,
    `The owner's main goal right now: ${goal ? GOAL_WORDS[goal] : "not given"}.`,
  ].join("\n");
}

/** The extra site brief the kit adds to the existing generator's prompt. */
export function starterSiteBrief(
  type: BusinessType | undefined,
  goal: PrimaryGoal | undefined,
  buttons: MainButton[],
): string {
  const lines = [
    "STARTER KIT RULES:",
    describeTypeAndGoal(type, goal),
    buttons.length
      ? `Main button (use on the homepage hero and the call-to-action; use only these links): ${buttons
          .map((button) => `"${button.label}" → ${button.href}`)
          .join("; ")}.`
      : 'No phone, email or address is known yet: use a button that links to another page of this site (for example "/contact") and never invent contact details.',
    'Every link is one of the links above or a page of this site starting with "/". Never use other links. No forms.',
  ];
  return lines.join("\n");
}

/* ── Link policy for kit-written pages ──────────────────────────────────── */

/** True for a link a kit page may carry: tel:, mailto:, https:, or a page of
 *  the same site ("/about", never "//host"). */
export function isAllowedStarterLink(href: string): boolean {
  const value = href.trim();
  if (!value) return true;
  // Browsers read "\\" as "/", so "/\\host" is another site: never allow it.
  if (value.includes("\\")) return false;
  if (value.startsWith("/")) return !value.startsWith("//");
  return /^(tel:|mailto:|https:\/\/)/i.test(value);
}

const HREF_IN_HTML = /href\s*=\s*["']([^"']*)["']/gi;

/** Every link in a block's props (button links and rich-text anchors). */
export function blockLinks(block: { props: Record<string, unknown> }): string[] {
  const links: string[] = [];
  for (const [key, value] of Object.entries(block.props)) {
    if (typeof value !== "string") continue;
    if (/href$/i.test(key)) links.push(value);
    for (const match of value.matchAll(HREF_IN_HTML)) links.push(match[1] ?? "");
  }
  return links;
}

/** Link-policy errors for one block (empty when every link is allowed). */
export function starterLinkErrors(block: { type: string; props: Record<string, unknown> }): string[] {
  return blockLinks(block)
    .filter((href) => !isAllowedStarterLink(href))
    .map(() => `${block.type}: links may only be tel:, mailto:, https: or a page of this site`);
}
