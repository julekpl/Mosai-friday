import { Globe, MapPin, ScanSearch, Store } from "lucide-react";
import { displayDomain } from "@/lib/url";

export function OnboardingPreview({
  workspaceName,
  website,
  listingQuery,
  listingSelected,
}: {
  workspaceName: string;
  website: string | null;
  listingQuery: string;
  listingSelected: boolean;
}) {
  return (
    <aside className="grid gap-5 rounded-lg border bg-card p-5 shadow-card sm:p-6" aria-labelledby="onboarding-preview-title">
      <div>
        <span className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 font-mono text-caption text-terminal-green">
          <ScanSearch className="size-3.5" aria-hidden="true" /> WHAT HAPPENS NEXT
        </span>
        <h2 id="onboarding-preview-title" className="mt-4 font-mono text-h2 font-semibold">Start with one real source.</h2>
        <p className="mt-2 font-mono text-caption text-muted-foreground">This step only sets your starting point. Nothing is scanned or added to your workspace until you continue and review the findings.</p>
      </div>

      <div className="grid gap-3">
        <div className="flex items-start gap-3 rounded-md border bg-background p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-tile-teal-soft text-tile-teal"><Store className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-caption text-muted-foreground">Private workspace</p>
            <p className="truncate font-mono text-small font-semibold">{workspaceName || "Your workspace name"}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-md border bg-background p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-tile-violet-soft text-tile-violet"><Globe className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-caption text-muted-foreground">Website source</p>
            <p className="truncate font-mono text-small font-semibold">{website ? displayDomain(website) : "Not added yet"}</p>
            <p className="mt-1 font-mono text-caption text-muted-foreground">{website ? "Will be scanned after you continue" : "Optional — you can start with a listing instead"}</p>
          </div>
        </div>
        {(listingQuery || listingSelected) && <div className="flex items-start gap-3 rounded-md border bg-background p-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-md bg-tile-sky-soft text-tile-sky"><MapPin className="size-4" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-caption text-muted-foreground">Google Business search</p>
            <p className="truncate font-mono text-small font-semibold">{listingSelected ? "Listing selected · review still required" : listingQuery}</p>
            <p className="mt-1 font-mono text-caption text-muted-foreground">A match is only a candidate until you confirm it.</p>
          </div>
        </div>}
      </div>

      <ol className="grid gap-3 border-t pt-4 font-mono text-caption">
        <li className="flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-terminal-green-soft font-semibold text-terminal-green">1</span><span><strong className="font-semibold">Choose a source</strong><span className="mt-0.5 block text-muted-foreground">A website, a business listing, or neither for now.</span></span></li>
        <li className="flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full border font-semibold text-muted-foreground">2</span><span><strong className="font-semibold">Review what’s found</strong><span className="mt-0.5 block text-muted-foreground">Edit or skip every suggested detail.</span></span></li>
        <li className="flex items-start gap-3"><span className="grid size-6 shrink-0 place-items-center rounded-full border font-semibold text-muted-foreground">3</span><span><strong className="font-semibold">Describe your audience</strong><span className="mt-0.5 block text-muted-foreground">Add who you serve and what you want to achieve.</span></span></li>
      </ol>
    </aside>
  );
}
