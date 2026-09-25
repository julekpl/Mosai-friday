/**
 * The Home "This week" next step, in outcome order (first-run blueprint §5):
 *
 *   1. publish the website (or make one)  → Build
 *   2. use or schedule this week's posts  → Promote
 *   3. add a way to be contacted          → checklist only until U6b (see below)
 *   4. look at your results               → Grow
 *   5. nothing to do                      → "You're set for this week"
 *
 * Truth rules (AGENTS.md §5.5): the snapshot is built only from server rows.
 * The website is "live" only when the hosting status says `live`; everything
 * else is a draft. Unknown data is never read as a success: unknown posts
 * are "check your posts", unknown contact details are "not contactable",
 * an unknown Google connection is "not connected". Audience profiles,
 * customer maps and content counts are reasons and "go deeper" links only,
 * never the step itself.
 */

export type WebsiteState = "none" | "draft" | "live";

export type OutcomeSnapshot = {
  /** Modules the org's plan includes (server capability matrix). */
  modules: readonly string[];
  /** `undefined` = unknown (not readable). */
  website: WebsiteState | undefined;
  /** `undefined` = unknown. `outThisWeek` counts posts that went out with a
   *  receipt or are scheduled. */
  posts: { drafts: number; outThisWeek: number } | undefined;
  /** A phone, email or address the site's main button can use. */
  contactable: boolean | undefined;
  /** The Google connection for Grow reports `connected`. */
  resultsConnected: boolean | undefined;
  personaCount?: number;
  journeyCount?: number;
  contentCount?: number;
};

export type OutcomeKey = "website" | "posts" | "contact" | "results" | "done";
export type ActionTarget = "build" | "promote" | "grow" | "create" | "billing";
export type ChecklistState = "next" | "to_do" | "has_record" | "locked";

export type ChecklistItem = {
  key: Exclude<OutcomeKey, "done">;
  label: string;
  detail: string;
  state: ChecklistState;
};

export type NextActionModel = {
  key: OutcomeKey;
  title: string;
  description: string;
  /** Status shown with `StatusBadge`; null when there is nothing to report. */
  status: { status: string; detail?: string } | null;
  locked: boolean;
  /** The one action for this state. `quiet` renders as a secondary link. */
  action: { label: string; target: ActionTarget; emphasis: "primary" | "quiet" };
  /** Reasons under the step, drawn from saved work. */
  why: string[];
  /** Places to go deeper; never the step itself. */
  deeper: { label: string; target: "understand" | "journeys" | "create" }[];
  checklist: ChecklistItem[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function lockedReason(module: "build" | "promote" | "grow", verb: string): string {
  return module === "grow"
    ? `${verb} needs the Scale plan or the Grow add-on`
    : `${verb} needs the Starter plan`;
}

function reasons(snapshot: OutcomeSnapshot): Pick<NextActionModel, "why" | "deeper"> {
  const { personaCount, journeyCount, contentCount, modules } = snapshot;
  const why: string[] = [];
  const deeper: NextActionModel["deeper"] = [];
  if (personaCount !== undefined && personaCount > 0) {
    why.push(`Written for the ${plural(personaCount, "customer type", "customer types")} you saved.`);
  }
  if (journeyCount !== undefined && journeyCount > 0) {
    why.push(`Follows the ${plural(journeyCount, "customer path", "customer paths")} you mapped.`);
  }
  if (contentCount !== undefined && contentCount > 0) {
    why.push(`${plural(contentCount, "draft", "drafts")} you can reuse.`);
  }
  if (modules.includes("understand")) deeper.push({ label: "Your customers", target: "understand" });
  if (modules.includes("journeys")) deeper.push({ label: "How people find you", target: "journeys" });
  if (modules.includes("create")) deeper.push({ label: "Your drafts", target: "create" });
  return { why, deeper };
}

export function getNextActionModel(snapshot: OutcomeSnapshot): NextActionModel {
  const { modules, website, posts } = snapshot;
  const has = (module: string) => modules.includes(module);
  const contactable = snapshot.contactable === true;
  const resultsConnected = snapshot.resultsConnected === true;
  const websiteLive = website === "live";
  const postsOut = posts !== undefined && posts.outThisWeek > 0;

  const checklist: ChecklistItem[] = [
    {
      key: "website",
      label: "Your website",
      state: !has("build") ? "locked" : websiteLive ? "has_record" : "to_do",
      detail: !has("build")
        ? lockedReason("build", "Publishing")
        : websiteLive
          ? "Live at your address"
          : website === "draft"
            ? "Draft, not published yet"
            : website === "none"
              ? "Not made yet"
              : "Not checked yet",
    },
    {
      key: "posts",
      label: "This week's posts",
      state: !has("promote") ? "locked" : postsOut ? "has_record" : "to_do",
      detail: !has("promote")
        ? lockedReason("promote", "Posting")
        : posts === undefined
          ? "Not checked yet"
          : postsOut
            ? `${plural(posts.outThisWeek, "post", "posts")} sent or scheduled`
            : posts.drafts > 0
              ? `${plural(posts.drafts, "draft", "drafts")} waiting for you`
              : "None ready yet",
    },
    {
      key: "contact",
      label: "A way to reach you",
      state: contactable ? "has_record" : "to_do",
      detail: contactable ? "Phone, email or address saved" : "No phone, email or address saved",
    },
    {
      key: "results",
      label: "Your results",
      state: !has("grow") ? "locked" : resultsConnected ? "has_record" : "to_do",
      detail: !has("grow")
        ? lockedReason("grow", "Results")
        : resultsConnected
          ? "Google account connected"
          : "Google account not connected",
    },
  ];

  const { why, deeper } = reasons(snapshot);
  const base = { why, deeper };
  const withNext = (key: ChecklistItem["key"] | "done"): ChecklistItem[] =>
    checklist.map((item) =>
      item.key === key && item.state !== "locked" ? { ...item, state: "next" } : item,
    );
  const billing = (label: string) =>
    ({ label, target: "billing", emphasis: "primary" }) as const;

  // 1. The website.
  if (!has("build")) {
    return {
      ...base,
      key: "website",
      title: "Put your website online",
      description: `${lockedReason("build", "Publishing")}. Your answers and drafts are kept.`,
      status: { status: "locked" },
      locked: true,
      action: billing("See plans"),
      checklist,
    };
  }
  if (!websiteLive) {
    const noDraft = website === "none";
    return {
      ...base,
      key: "website",
      title: noDraft ? "Make your website" : website === "draft" ? "Publish your website" : "Check your website",
      description: noDraft
        ? "Start from your business details. It stays a draft until you publish it."
        : website === "draft"
          ? "Your website is a draft. Publish it so people can find you at a real address."
          : "We could not read your website's status. Open it to see where it stands.",
      status: website === "draft" ? { status: "draft" } : noDraft ? { status: "not_started" } : null,
      locked: false,
      action: {
        label: noDraft ? "Make your website" : website === "draft" ? "Publish your website" : "Open your website",
        target: "build",
        emphasis: "primary",
      },
      checklist: withNext("website"),
    };
  }

  // 2. This week's posts.
  if (!has("promote")) {
    return {
      ...base,
      key: "posts",
      title: "Use this week's posts",
      description: `${lockedReason("promote", "Posting")}. Your drafts are kept.`,
      status: { status: "locked" },
      locked: true,
      action: billing("See plans"),
      checklist,
    };
  }
  if (!postsOut) {
    const unknown = posts === undefined;
    const drafts = posts?.drafts ?? 0;
    return {
      ...base,
      key: "posts",
      title: unknown ? "Check your posts" : drafts > 0 ? "Use or schedule this week's posts" : "Get this week's posts ready",
      description: unknown
        ? "We could not count your posts. Open them to see what is ready."
        : drafts > 0
          ? `You have ${plural(drafts, "draft", "drafts")}. Nothing goes out until you choose to send or schedule it.`
          : "Write a few posts for this week. They stay drafts until you choose to send them.",
      status: !unknown && drafts > 0 ? { status: "draft", detail: plural(drafts, "post", "posts") } : null,
      locked: false,
      action: {
        label: unknown ? "Check your posts" : drafts > 0 ? "Review your posts" : "Write this week's posts",
        target: "promote",
        emphasis: "primary",
      },
      checklist: withNext("posts"),
    };
  }

  // 3. A way to be contacted: shown on the checklist, but not a blocking
  // step yet. No screen lets the owner add a phone, email or booking link
  // after the first run, so making it "the next step" would trap them here
  // (lead review, U6). U6b adds those fields to Edit project and restores it.

  // 4. Results.
  if (!has("grow")) {
    return {
      ...base,
      key: "results",
      title: "Look at your results",
      description: `${lockedReason("grow", "Results")}. Everything else keeps working.`,
      status: { status: "locked" },
      locked: true,
      action: billing("See plans"),
      checklist,
    };
  }
  if (!resultsConnected) {
    return {
      ...base,
      key: "results",
      title: "Look at your results",
      description: "Connect your Google account to see how many people visit and search for you.",
      status: null,
      locked: false,
      action: { label: "Connect Google", target: "grow", emphasis: "primary" },
      checklist: withNext("results"),
    };
  }

  // 5. Nothing to do.
  return {
    ...base,
    key: "done",
    title: "You're set for this week",
    description: contactable
      ? "Your website is online, your posts are going out and people can reach you."
      : "Your website is online and your posts are going out.",
    status: null,
    locked: false,
    action: { label: "See your results", target: "grow", emphasis: "quiet" },
    checklist,
  };
}

/* ── Snapshot helpers: pure reads of rows Home already loads ─────────────── */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** "live" only from the hosting status; any website build is a draft. */
export function websiteStateFrom(
  builds: readonly { kind: string }[] | undefined,
  hosting: { state: string } | null | undefined,
): WebsiteState | undefined {
  if (hosting?.state === "live") return "live";
  if (builds === undefined) return undefined;
  return builds.some((build) => build.kind === "website") ? "draft" : "none";
}

/** Drafts, plus posts that went out this week with a receipt or are scheduled. */
export function postCountsFrom(
  posts:
    | readonly { status: string; providerRef?: string; publishedAt?: number }[]
    | undefined,
  now: number,
): OutcomeSnapshot["posts"] {
  if (posts === undefined) return undefined;
  let drafts = 0;
  let outThisWeek = 0;
  for (const post of posts) {
    if (post.status === "draft") drafts += 1;
    else if (post.status === "scheduled") outThisWeek += 1;
    else if (
      post.status === "published" &&
      typeof post.providerRef === "string" &&
      post.providerRef.trim() !== "" &&
      post.publishedAt !== undefined &&
      now - post.publishedAt <= WEEK_MS
    ) {
      outThisWeek += 1;
    }
  }
  return { drafts, outThisWeek };
}

type ContactFields = { phone?: string; email?: string; address?: string };

/** A phone, email or address saved on the project (scan or Google listing). */
export function isContactable(
  project:
    | { websiteScan?: { businessDetails?: ContactFields; gmb?: ContactFields } }
    | null
    | undefined,
): boolean | undefined {
  if (project === undefined) return undefined;
  const filled = (value: string | undefined) => typeof value === "string" && value.trim() !== "";
  const sources = [project?.websiteScan?.businessDetails, project?.websiteScan?.gmb];
  return sources.some(
    (details) => !!details && (filled(details.phone) || filled(details.email) || filled(details.address)),
  );
}
