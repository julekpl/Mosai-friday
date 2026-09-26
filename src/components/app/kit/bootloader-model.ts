/**
 * Kit bootloader ("Mosaic assembles") — the pure mapping from the starter kit
 * job to what the full-screen loader on Home shows. No React here, so the
 * tile fill, the checklist rows, the finished-kit detection and the "should
 * it show" rule are unit-tested directly.
 *
 * Truth rule (AGENTS.md §5.5, blueprint §3): every tile and every line comes
 * from `starterKit.get` only. Nothing here reads a clock to move progress;
 * the one clock read (`isStaleKit`) only decides whether a kit is still being
 * worked on at all, so a dead kit never shows a loader that cannot finish.
 */

import { STARTER_KIT_STEPS, isStaleKit } from "@/shared/starterKitJob";
import type { StarterKitPart, StarterKitPartName, StarterKitStatus } from "@/shared/starterKit";
import { KIT_PART_ORDER, PART_NOUN, PART_TITLE, cardState, kitCardCopy } from "@/components/app/kit/kit-model";

/** What a part looks like on the loader. */
export type BootPartState = "waiting" | "working" | "done" | "partial" | "failed" | "locked";

/** States the job will not move on from without the owner. */
const SETTLED: ReadonlySet<BootPartState> = new Set(["done", "partial", "failed", "locked"]);

type PartInput = Pick<StarterKitPart, "status" | "errorCode" | "step" | "message">;

export function bootPartState(part: PartInput): BootPartState {
  switch (cardState(part)) {
    case "working":
      return part.status === "running" ? "working" : "waiting";
    case "succeeded":
      return "done";
    case "partially_succeeded":
      return "partial";
    case "failed":
      return "failed";
    case "locked":
      return "locked";
  }
}

export function isPartSettled(part: PartInput): boolean {
  return SETTLED.has(bootPartState(part));
}

/** True when no part will change again without the owner. */
export function isKitSettled(parts: Record<StarterKitPartName, PartInput>): boolean {
  return KIT_PART_ORDER.every((name) => isPartSettled(parts[name]));
}

/* ── Tiles ─────────────────────────────────────────────────────────────── */

export const TILES_PER_PART = 4;

/**
 * The mosaic: 12 tiles, 4 per part, mixed so each part's tiles land across
 * the whole picture. Tiles of one part fill in this order.
 */
export const TILE_LAYOUT: readonly StarterKitPartName[] = [
  "plan",
  "site",
  "posts",
  "plan",
  "posts",
  "plan",
  "site",
  "posts",
  "site",
  "posts",
  "plan",
  "site",
];

/** The real steps each part goes through, in the order the job writes them. */
export const PART_STEPS: Record<StarterKitPartName, readonly string[]> = {
  plan: [STARTER_KIT_STEPS.reading, STARTER_KIT_STEPS.plan],
  site: [STARTER_KIT_STEPS.site],
  posts: [STARTER_KIT_STEPS.posts, STARTER_KIT_STEPS.pictures],
};

/** Where the part's current step sits in its list, or null when unknown. */
export function stepIndex(name: StarterKitPartName, step: string | undefined): number | null {
  const trimmed = step?.trim();
  if (!trimmed) return null;
  const index = PART_STEPS[name].indexOf(trimmed);
  return index === -1 ? null : index;
}

export type PartFill = {
  state: BootPartState;
  total: number;
  /** Tiles shown solid. */
  filled: number;
  /** The next tile shows "being worked on" (decoration, never a count). */
  active: boolean;
};

/**
 * How many of a part's tiles are solid. A running part fills only for the
 * steps the job has already moved past; a finished part fills all; a
 * partial part leaves one tile as the named gap.
 */
export function partFill(name: StarterKitPartName, part: PartInput): PartFill {
  const state = bootPartState(part);
  const total = TILES_PER_PART;
  switch (state) {
    case "done":
      return { state, total, filled: total, active: false };
    case "partial":
      return { state, total, filled: total - 1, active: false };
    case "working": {
      const index = stepIndex(name, part.step);
      const filled = index === null ? 0 : Math.floor((total * index) / PART_STEPS[name].length);
      return { state, total, filled, active: true };
    }
    default:
      return { state, total, filled: 0, active: false };
  }
}

export type TileState = "filled" | "active" | "empty" | "gap" | "failed" | "locked";

export type Tile = { key: string; part: StarterKitPartName; state: TileState };

export function tileState(fill: PartFill, position: number): TileState {
  if (fill.state === "failed") return "failed";
  if (fill.state === "locked") return "locked";
  if (position < fill.filled) return "filled";
  if (fill.state === "partial") return "gap";
  if (fill.active && position === fill.filled) return "active";
  return "empty";
}

export function mosaicTiles(parts: Record<StarterKitPartName, PartInput>): Tile[] {
  const fills = {
    plan: partFill("plan", parts.plan),
    site: partFill("site", parts.site),
    posts: partFill("posts", parts.posts),
  };
  const seen: Record<StarterKitPartName, number> = { plan: 0, site: 0, posts: 0 };
  return TILE_LAYOUT.map((part, index) => {
    const position = seen[part]++;
    return { key: `${part}-${index}`, part, state: tileState(fills[part], position) };
  });
}

/* ── Checklist ─────────────────────────────────────────────────────────── */

/** The `StatusBadge` label per state: plain words, never "live". */
export const BOOT_BADGE: Record<BootPartState, string> = {
  waiting: "waiting",
  working: "drafting",
  done: "draft",
  partial: "needs_a_fix",
  failed: "failed",
  locked: "locked",
};

export type ChecklistRow = {
  name: StarterKitPartName;
  title: string;
  state: BootPartState;
  badge: string;
  /** The job's real step while working; the outcome once settled. */
  text: string;
};

export function checklistRow(name: StarterKitPartName, part: PartInput): ChecklistRow {
  const state = bootPartState(part);
  const step = part.step?.trim();
  let text: string;
  switch (state) {
    case "waiting":
      text = step || "Waiting to start";
      break;
    case "working":
      text = step || `Drafting your ${PART_NOUN[name]}…`;
      break;
    case "partial": {
      const copy = kitCardCopy(name, part);
      text = copy.detail ? `${copy.headline}. ${copy.detail}` : copy.headline;
      break;
    }
    default:
      text = kitCardCopy(name, part).headline;
  }
  return { name, title: PART_TITLE[name], state, badge: BOOT_BADGE[state], text };
}

export function checklistRows(parts: Record<StarterKitPartName, PartInput>): ChecklistRow[] {
  return KIT_PART_ORDER.map((name) => checklistRow(name, parts[name]));
}

/* ── Header copy ───────────────────────────────────────────────────────── */

export type BootHeading = { title: string; description: string };

/** "Your plan", "Your website and posts", "Your plan, website and posts". */
function partList(names: readonly StarterKitPartName[]): string {
  const nouns = names.map((name) => PART_NOUN[name]);
  const joined = nouns.length > 1 ? `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}` : nouns[0];
  return `Your ${joined}`;
}

/** "needs" for one singular part, "need" otherwise ("posts" is plural). */
function needVerb(names: readonly StarterKitPartName[]): string {
  return names.length === 1 && names[0] !== "posts" ? "needs" : "need";
}

/**
 * The loader's header once settled. Truth rule: "ready" only when nothing
 * failed; a plan-gated (`locked`) part is not a failure and never reads as
 * "could not finish".
 */
export function bootHeading(parts: Record<StarterKitPartName, PartInput>): BootHeading {
  if (!isKitSettled(parts)) {
    return {
      title: "Making your starter kit",
      description: "Your plan, website and posts fill in as each one is drafted.",
    };
  }
  const withState = (...wanted: BootPartState[]) =>
    KIT_PART_ORDER.filter((name) => wanted.includes(bootPartState(parts[name])));
  const done = withState("done");
  const ready = withState("done", "partial");
  const needHand = withState("partial", "failed");
  const failed = withState("failed");
  const locked = withState("locked");
  const lockedLine = locked.length ? `${partList(locked)} ${needVerb(locked)} the Starter plan.` : "";

  if (done.length === KIT_PART_ORDER.length) {
    return { title: "Your kit is ready", description: "Everything is a draft you can change." };
  }
  if (ready.length > 0) {
    if (needHand.length === 0) {
      return { title: "Your kit is ready", description: `Everything else is a draft you can change. ${lockedLine}` };
    }
    const handLine = `${partList(needHand)} ${needVerb(needHand)} a hand. Your kit shows what to do next.`;
    return {
      title: "Part of your kit is ready",
      description: lockedLine ? `${handLine} ${lockedLine}` : handLine,
    };
  }
  if (failed.length === 0) {
    return {
      title: `${partList(locked)} ${needVerb(locked)} the Starter plan`,
      description: "Your answers are saved. Your kit fills in once your plan includes it.",
    };
  }
  const retry = "Your answers are saved. You can try again from your kit.";
  return {
    title: "We could not finish your kit",
    description: lockedLine ? `${retry} ${lockedLine}` : retry,
  };
}

/**
 * The polite announcement for what changed between two checklist snapshots,
 * or null when nothing did. The first snapshot announces nothing: the
 * visible screen already says it.
 */
export function checklistAnnouncement(
  previous: readonly ChecklistRow[] | null,
  next: readonly ChecklistRow[],
  heading: BootHeading,
  wasSettled: boolean,
  settled: boolean,
): string | null {
  if (!previous) return null;
  const lines: string[] = [];
  for (const row of next) {
    const before = previous.find((item) => item.name === row.name);
    if (!before || before.state !== row.state || before.text !== row.text) {
      lines.push(`${row.title}: ${row.text.replace(/[.…]+$/, "")}.`);
    }
  }
  if (settled && !wasSettled) lines.push(`${heading.title}.`);
  return lines.length ? lines.join(" ") : null;
}

/* ── When it shows ─────────────────────────────────────────────────────── */

export type BootKit = {
  _id: string;
  status: StarterKitStatus;
  updatedAt: number;
  dismissedAt?: number;
  parts: Record<StarterKitPartName, PartInput>;
};

/**
 * Show the loader for a kit the job is still working on right now: queued
 * or running, not stale, not hidden on the server, not closed by this
 * viewer, and with at least one part still moving.
 */
export function shouldShowBootloader(
  kit: BootKit | null | undefined,
  { now, dismissed }: { now: number; dismissed: boolean },
): boolean {
  if (!kit || dismissed || kit.dismissedAt !== undefined) return false;
  if (kit.status !== "queued" && kit.status !== "running") return false;
  if (isStaleKit(kit, now)) return false;
  return !isKitSettled(kit.parts);
}

/* ── Per-viewer dismissal (a convenience, never required) ─────────────── */

export const DISMISS_KEY_PREFIX = "mosai.kitBootloader.closed.";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/** Whether this viewer closed the loader for this kit. False if storage fails. */
export function readDismissed(store: () => KeyValueStore | null | undefined, kitId: string): boolean {
  try {
    return store()?.getItem(`${DISMISS_KEY_PREFIX}${kitId}`) === "1";
  } catch {
    return false;
  }
}

/** Remember the close. A blocked or full storage is ignored. */
export function writeDismissed(store: () => KeyValueStore | null | undefined, kitId: string): void {
  try {
    store()?.setItem(`${DISMISS_KEY_PREFIX}${kitId}`, "1");
  } catch {
    // Private window or blocked site data: the close still holds in memory.
  }
}
