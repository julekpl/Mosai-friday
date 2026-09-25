import { X } from "lucide-react";

import type { GenerateContentResult } from "@/convex/ai";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** What the model was actually given for the last draft: per source, full
 *  text or excerpts (and how much). Truth over impression. */
export function DraftReport({
  result,
  onDismiss,
}: {
  result: GenerateContentResult;
  onDismiss: () => void;
}) {
  const full = result.sources.filter((source) => source.mode === "full").length;
  const excerpts = result.sources.filter((source) => source.mode === "excerpts").length;
  const omitted = result.sources.filter((source) => source.mode === "omitted").length;
  return (
    <section aria-label="What the AI read for the last draft" className="grid gap-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-mono text-caption font-medium">What the AI read for the last draft</p>
        <span className="font-mono text-caption text-muted-foreground">
          {result.sources.length === 0
            ? "no sources included"
            : [
                full ? `${full} in full` : null,
                excerpts ? `${excerpts} as relevant excerpts` : null,
                omitted ? `${omitted} left out (too little room)` : null,
              ].filter(Boolean).join(" · ")}
          {result.findingsUsed ? ` · ${result.findingsUsed} research snippet${result.findingsUsed === 1 ? "" : "s"}` : ""}
        </span>
        <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Hide this report" onClick={onDismiss}>
          <X className="size-3.5" />
        </Button>
      </div>
      {result.sources.length > 0 && (
        <ul className="grid gap-1">
          {result.sources.map((source) => (
            <li key={source.id} className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-caption">
              <Badge variant="outline" className="font-mono text-caption">{source.label}</Badge>
              <span className="min-w-0 flex-1 truncate">{source.title}</span>
              <span className={source.mode === "full" ? "text-terminal-green-ink" : "text-terminal-amber-ink"}>
                {source.mode === "full"
                  ? "full text"
                  : source.mode === "excerpts"
                    ? `excerpts: ${Math.round((source.includedChars / Math.max(1, source.totalChars)) * 100)}% of ${source.totalChars.toLocaleString()} chars`
                    : "not included"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
