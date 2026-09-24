/**
 * "Publish to web" contract and honest display rules (owner decision,
 * 24 Sep 2026: customer websites are served at `/s/<slug>-website/<page>`).
 *
 * The backend functions are referenced by name so this UI does not depend on
 * regenerated Convex bindings for the new `siteHosting` module.
 *
 * Truth rule (AGENTS.md rule 5): the UI says "Live" ONLY when the server
 * reports `state === "live"`. Nothing here infers liveness from a click, a
 * returned path or a prepared release.
 */
import { makeFunctionReference } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";

export type SiteHostingState = "not_deployed" | "deploying" | "live" | "failed";

export type SiteHostingStatus = {
  slug: string | null;
  path: string | null;
  state: SiteHostingState;
  lastDeployedAt: number | null;
  error: string | null;
};

export const siteHostingStatusQuery = makeFunctionReference<
  "query",
  { projectId: Id<"projects"> },
  SiteHostingStatus
>("siteHosting:status");

export const deployWebsiteAction = makeFunctionReference<
  "action",
  { projectId: Id<"projects"> },
  { path: string }
>("siteHosting:deployWebsite");

export type HostingTone = "live" | "progress" | "failed" | "neutral";

export type HostingStateView = {
  tone: HostingTone;
  /** Badge text shown to the user. */
  text: string;
  /** True only for a server-confirmed live site. */
  isLive: boolean;
};

/** Map the server state to what the user sees. */
export function hostingStateView(
  status: Pick<SiteHostingStatus, "state" | "error"> | null | undefined,
): HostingStateView {
  switch (status?.state) {
    case "live":
      return { tone: "live", text: "Live", isLive: true };
    case "deploying":
      return { tone: "progress", text: "Publishing…", isLive: false };
    case "failed":
      return {
        tone: "failed",
        text: status.error ? `Publish failed: ${status.error}` : "Publish failed",
        isLive: false,
      };
    default:
      return { tone: "neutral", text: "Not on the web yet", isLive: false };
  }
}

/** Only well-formed public-site paths become links; anything else is
 *  ignored rather than rendered as an address. */
const PUBLIC_PATH = /^\/s\/[a-z0-9][a-z0-9-]*-website(?:\/[A-Za-z0-9._~/-]*)?$/;

/** Full public URL for a status path on the given origin, or null. */
export function publicSiteUrl(origin: string, path: string | null | undefined): string | null {
  if (!path || !PUBLIC_PATH.test(path) || path.includes("..")) return null;
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/** True when a deploy error says the site needs a prepared release first. */
export function needsPreparedRelease(message: string): boolean {
  return /prepar\w*\s+(a\s+|the\s+)?release|release\s+(is\s+)?(not\s+)?prepared|no\s+prepared/i.test(
    message,
  );
}

/** Primary button text: first publish vs. update of a site already on the web. */
export function publishButtonLabel(
  status: Pick<SiteHostingStatus, "state" | "lastDeployedAt"> | null | undefined,
): string {
  if (status?.state === "live" || (status?.lastDeployedAt ?? null) !== null) {
    return "Update live site";
  }
  return "Publish to web";
}
