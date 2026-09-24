import { Trash2 } from "lucide-react";

import { ConfirmDelete, StatusBadge } from "@/components/app/module-kit";
import { siteStatusForDisplay } from "@/components/cms/releaseLabels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type BuildListRow = {
  _id: string;
  name: string;
  kind: "website" | "app";
  status: string;
  positioning?: string;
  seoReady?: boolean;
  wcagReady?: boolean;
  createdAt: number;
};

/** What a build deletion removes, stated before the user confirms. */
export const BUILD_DELETE_DESCRIPTION =
  "This removes the build with its chat history, versions, page plans and release records. Your site's pages stay in the project. This cannot be undone.";

/**
 * The project's build list. Each row owns its delete confirmation, with the
 * row's trash button as the dialog trigger, so the dialog always opens for
 * the row that was clicked. (It used to be one shared dialog with a hidden
 * trigger that never opened.)
 */
export function BuildList<T extends BuildListRow>({
  builds,
  onOpen,
  onDelete,
}: {
  builds: readonly T[];
  onOpen: (build: T) => void;
  onDelete: (build: T) => Promise<void>;
}) {
  return (
    <div className="grid min-w-0 gap-3">
      {builds.map((b) => (
        <div
          key={b._id}
          className="flex min-w-0 flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card transition-colors ease-terminal hover:bg-accent"
        >
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer text-left"
            onClick={() => onOpen(b)}
          >
            <p className="break-words font-mono text-small font-medium">
              {b.name} <span className="text-muted-foreground">· {b.kind}</span>
            </p>
            {b.positioning ? (
              <p className="break-words font-mono text-caption text-muted-foreground">
                {b.positioning}
              </p>
            ) : (
              <p className="font-mono text-caption text-muted-foreground">
                created {new Date(b.createdAt).toLocaleDateString()}
              </p>
            )}
          </button>
          <Badge variant="outline" className="font-mono text-caption text-muted-foreground">
            {/* BP-03: server no longer records seoReady/wcagReady client
                claims; show a neutral legacy label instead of a fake ok. */}
            {b.seoReady === true ? "seo: legacy ok — verify" : "seo: —"} ·{" "}
            {b.wcagReady === true ? "wcag: legacy ok — verify" : "wcag: —"}
          </Badge>
          <StatusBadge status={siteStatusForDisplay(b.status)} />
          <ConfirmDelete
            what={`"${b.name}"`}
            description={BUILD_DELETE_DESCRIPTION}
            onConfirm={() => onDelete(b)}
            trigger={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${b.name}`}
                className="cursor-pointer text-destructive"
              >
                <Trash2 className="size-3.5" />
              </Button>
            }
          />
        </div>
      ))}
    </div>
  );
}
