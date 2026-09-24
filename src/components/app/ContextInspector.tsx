import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";

/** Shows the exact authorized evidence sources and known gaps for Build AI. */
export function ContextInspector({ projectId, buildId }: { projectId: Id<"projects">; buildId?: Id<"builds"> }) {
  const pack = useQuery(api.guards.inspectAiContext, { projectId, buildId });

  return (
    <details className="rounded-md border bg-card px-4 py-3 shadow-card">
      <summary className="cursor-pointer font-mono text-small font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Review AI context
      </summary>
      <div className="mt-3 grid gap-3">
        {pack === undefined ? (
          <p role="status" className="font-mono text-caption text-muted-foreground">
            Loading project sources…
          </p>
        ) : pack === null ? (
          <p role="status" className="font-mono text-caption text-muted-foreground">
            Project context is unavailable.
          </p>
        ) : (
          <>
            <p className="font-mono text-caption text-muted-foreground">
              Server-loaded project context for this build. The current request can also contribute text, and this list is not an exhaustive transcript of the prompt. Scraped and uploaded text is treated as untrusted data.
            </p>
            <ul className="grid gap-2">
              {pack.evidence.map((item) => (
                <li key={item.ref} className="rounded-md border px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-caption font-medium">{item.title}</span>
                    <Badge variant="outline">{item.source}</Badge>
                    <Badge variant="outline">{item.trust === "untrusted_source_text" ? "untrusted source text" : item.trust === "provider_data" ? "provider data" : "workspace entry"}</Badge>
                    {item.truncated && <Badge variant="outline">excerpt shortened for context budget</Badge>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-caption text-muted-foreground">
                    {item.text}
                  </p>
                  <p className="mt-1 font-mono text-caption text-muted-foreground">
                    Ref {item.ref} · {item.version}
                  </p>
                </li>
              ))}
            </ul>
            {pack.gaps.length > 0 && (
              <section aria-labelledby="context-gaps-heading">
                <h3 id="context-gaps-heading" className="font-mono text-caption font-medium">Missing sources</h3>
                <ul className="mt-1 list-disc pl-5 font-mono text-caption text-muted-foreground">
                  {pack.gaps.map((gap) => <li key={gap}>{gap}</li>)}
                </ul>
              </section>
            )}
            <section aria-labelledby="context-assumptions-heading">
              <h3 id="context-assumptions-heading" className="font-mono text-caption font-medium">Assumptions</h3>
              <ul className="mt-1 list-disc pl-5 font-mono text-caption text-muted-foreground">
                {pack.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}
              </ul>
            </section>
          </>
        )}
      </div>
    </details>
  );
}
