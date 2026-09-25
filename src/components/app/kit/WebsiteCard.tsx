import { useQuery } from "convex/react";
import { Link } from "react-router";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import type { StarterKitPart } from "@/shared/starterKit";
import { KitPartCard } from "@/components/app/kit/KitPartCard";
import { DRAFT_SITE_LINE, PARTIAL_FIX_LABEL, liveSiteAddress } from "@/components/app/kit/kit-model";

/**
 * The website card. The address appears only when `siteHosting.status` says
 * `live`; until then it is a draft. Publishing is never done here: "Publish"
 * opens the build, where the receipt-backed publish flow lives.
 */
export function WebsiteCard({
  projectId,
  part,
  buildId,
  hasBuild,
  onRetry,
  retrying,
}: {
  projectId: Id<"projects">;
  part: StarterKitPart;
  buildId: Id<"builds"> | undefined;
  /** The plan includes Build; otherwise the hosting query is skipped. */
  hasBuild: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  const hosting = useQuery(api.siteHosting.status, hasBuild ? { projectId } : "skip");
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const address = liveSiteAddress(hosting, origin);
  const buildHref = buildId
    ? `/app/${projectId}/build?build=${encodeURIComponent(buildId)}`
    : `/app/${projectId}/build`;

  return (
    <KitPartCard
      name="site"
      part={part}
      badge={address ? "live" : undefined}
      onRetry={onRetry}
      retrying={retrying}
      result={
        address ? (
          <p className="min-w-0 text-small">
            On the web at{" "}
            <a
              href={address}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-medium text-primary underline underline-offset-4"
            >
              {address}
            </a>
          </p>
        ) : (
          <p className="text-small text-muted-foreground">{DRAFT_SITE_LINE}</p>
        )
      }
      actions={
        <>
          <Button asChild className="min-h-11">
            <Link to={buildHref}>Look at it</Link>
          </Button>
          {address ? null : (
            <Button asChild variant="outline" className="min-h-11">
              <Link to={buildHref}>Publish</Link>
            </Button>
          )}
        </>
      }
      fixAction={
        <Button asChild className="min-h-11">
          <Link to={buildHref}>{PARTIAL_FIX_LABEL.site}</Link>
        </Button>
      }
    />
  );
}
