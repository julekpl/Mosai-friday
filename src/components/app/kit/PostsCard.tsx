import { useState } from "react";
import { Link } from "react-router";
import { Copy, Download } from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";
import type { StarterKitContent } from "@/convex/starterKit";
import { Button } from "@/components/ui/button";
import type { StarterKitPart } from "@/shared/starterKit";
import { KitPartCard } from "@/components/app/kit/KitPartCard";
import { MAX_KIT_POSTS, PARTIAL_FIX_LABEL, channelLabel, httpsUrl } from "@/components/app/kit/kit-model";

type KitPost = StarterKitContent["posts"][number];

const PEXELS_URL = "https://www.pexels.com";

function PostItem({ post, onCopy }: { post: KitPost; onCopy: (text: string) => void }) {
  const channel = channelLabel(post.channel);
  const picture = httpsUrl(post.mediaUrl);
  const photographerUrl = httpsUrl(post.attribution?.photographerUrl);
  return (
    <li className="grid min-w-0 gap-2 rounded-lg border bg-background p-3">
      <p className="text-small font-semibold">{channel}</p>
      {picture ? (
        <img
          src={picture}
          alt={`Picture for your ${channel} post`}
          loading="lazy"
          className="aspect-video w-full rounded-md bg-muted object-cover"
        />
      ) : null}
      {post.attribution ? (
        <p className="text-caption text-muted-foreground">
          Photo by{" "}
          {photographerUrl ? (
            <a href={photographerUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {post.attribution.photographer}
            </a>
          ) : (
            post.attribution.photographer
          )}
        </p>
      ) : null}
      <p className="line-clamp-3 break-words text-small">{post.body}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => onCopy(post.body)}
          aria-label={`Copy text of your ${channel} post`}
        >
          <Copy className="size-4" aria-hidden="true" />
          Copy text
        </Button>
        {picture ? (
          <Button asChild variant="outline" className="min-h-11">
            <a href={picture} download aria-label={`Download picture for your ${channel} post`}>
              <Download className="size-4" aria-hidden="true" />
              Download picture
            </a>
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/**
 * The posts card: up to seven drafts to copy or download. Scheduling lives
 * in Promote; this card never schedules or sends anything.
 */
export function PostsCard({
  projectId,
  part,
  posts,
  onRetry,
  retrying,
}: {
  projectId: Id<"projects">;
  part: StarterKitPart;
  posts: KitPost[];
  onRetry: () => void;
  retrying: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const shown = posts.slice(0, MAX_KIT_POSTS);
  const anyAttribution = shown.some((post) => post.attribution);
  const promoteHref = `/app/${projectId}/promote`;

  const copy = async (text: string) => {
    // Reset first so the same message is announced again on a second copy.
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Could not copy. Select the text and copy it yourself.");
    }
  };

  return (
    <KitPartCard
      name="posts"
      part={part}
      onRetry={onRetry}
      retrying={retrying}
      result={
        <div className="grid gap-3">
          <p className="sr-only" role="status" aria-live="polite">
            {copyStatus}
          </p>
          {shown.length ? (
            <ul className="grid gap-3" aria-label="Your post drafts">
              {shown.map((post) => (
                <PostItem key={post._id} post={post} onCopy={(text) => void copy(text)} />
              ))}
            </ul>
          ) : (
            <p className="text-small text-muted-foreground">No posts to show yet.</p>
          )}
          {anyAttribution ? (
            <p className="text-caption text-muted-foreground">
              <a href={PEXELS_URL} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                Photos provided by Pexels
              </a>
            </p>
          ) : null}
        </div>
      }
      actions={
        <Button asChild className="min-h-11">
          <Link to={promoteHref}>Schedule</Link>
        </Button>
      }
      fixAction={
        <>
          <Button asChild className="min-h-11">
            <Link to={promoteHref}>{PARTIAL_FIX_LABEL.posts}</Link>
          </Button>
        </>
      }
    />
  );
}
