import { Sparkles } from "lucide-react";
import type { ScanResult } from "@/convex/scraping";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { displayDomain } from "@/lib/url";

export function WebsiteMapReview({
  scanResult,
  businessName,
  onBusinessDetailChange,
}: {
  scanResult: Partial<Omit<ScanResult, "url" | "scannedAt">>;
  businessName: string;
  onBusinessDetailChange: (field: keyof NonNullable<ScanResult["businessDetails"]>, value: string) => void;
}) {
  const coverage = scanResult.coverage;
  const details = scanResult.businessDetails;
  return (
    <section className="grid gap-4 rounded-lg border bg-card p-4 sm:p-5" aria-labelledby="website-map-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-terminal-green"><Sparkles className="size-4" aria-hidden="true" /><span className="font-mono text-caption font-semibold">What we found about your business</span></div>
          <h2 id="website-map-title" className="mt-1 font-mono text-h2 font-semibold">Check what MOSAI found</h2>
          <p className="mt-1 font-mono text-caption text-muted-foreground">These are candidates from public pages, not verified business facts. Correct anything that looks wrong below.</p>
        </div>
        {coverage && <Badge variant="outline" className="font-mono text-caption">{coverage.scannedPageCount} pages read</Badge>}
      </div>
      {coverage && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border p-3"><p className="font-mono text-h2 font-semibold">{coverage.scannedPageCount}</p><p className="font-mono text-caption text-muted-foreground">pages read</p></div>
        <div className="rounded-md border p-3"><p className="font-mono text-h2 font-semibold">{coverage.discoveredPageCount}</p><p className="font-mono text-caption text-muted-foreground">pages found</p></div>
        <div className="rounded-md border p-3"><p className="font-mono text-h2 font-semibold">{coverage.sitemapCount}</p><p className="font-mono text-caption text-muted-foreground">sitemap files</p></div>
        <div className="rounded-md border p-3"><p className="font-mono text-h2 font-semibold">{scanResult.socialChannels?.length ?? 0}</p><p className="font-mono text-caption text-muted-foreground">social links</p></div>
      </div>}
      {coverage?.truncated && <p role="status" className="rounded-md border border-terminal-amber/40 bg-terminal-amber-soft p-3 font-mono text-caption text-terminal-amber">This is a first pass: the site listed more pages than we could read here. MOSAI chose key pages and stopped at its {coverage.pageLimit}-page limit. Review the page list and re-scan later for a deeper crawl.</p>}
      {coverage?.failedPageCount ? <p role="status" className="font-mono text-caption text-terminal-amber">{coverage.failedPageCount} discovered pages couldn’t be read. They’re not counted as scanned.</p> : null}
      {coverage?.skippedByRobotsCount ? <p className="font-mono text-caption text-muted-foreground">{coverage.skippedByRobotsCount} pages were skipped because of robots.txt rules.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <h3 className="font-mono text-small font-semibold">Business details</h3>
          <div className="mt-2 grid gap-2 font-mono text-caption">
            {([
              ["name", "Business name", businessName || details?.name || ""],
              ["address", "Address", details?.address || ""],
              ["country", "Country", details?.country || ""],
              ["phone", "Phone", details?.phone || ""],
              ["email", "Email", details?.email || ""],
            ] as const).map(([field, label, value]) => <div key={field} className="grid gap-1">
              <Label htmlFor={`scan-${field}`} className="text-muted-foreground">{label}{field === "name" ? "" : " (optional)"}</Label>
              <Input id={`scan-${field}`} type={field === "email" ? "email" : "text"} value={value} onChange={(event) => onBusinessDetailChange(field, event.target.value)} placeholder={`Add ${label.toLowerCase()} if useful`} />
            </div>)}
            {!details?.address && !details?.country && !details?.phone && !details?.email && <p className="text-muted-foreground">No structured address or contact details were found. Add anything you want MOSAI to know.</p>}
          </div>
          {details?.footerExcerpt && <details className="mt-3 border-t pt-2"><summary className="cursor-pointer font-mono text-caption">View footer text source</summary><p className="mt-2 font-mono text-caption text-muted-foreground">{details.footerExcerpt}</p></details>}
        </div>
        <div className="grid gap-3">
          <div className="rounded-md border p-3">
            <h3 className="font-mono text-small font-semibold">Products and services</h3>
            {scanResult.productsServices?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{scanResult.productsServices.slice(0, 16).map((item) => <Badge key={item} variant="outline" className="font-mono text-caption">{item}</Badge>)}</div> : <p className="mt-2 font-mono text-caption text-muted-foreground">No clear offers found yet.</p>}
          </div>
          <div className="rounded-md border p-3">
            <h3 className="font-mono text-small font-semibold">Social links on the website</h3>
            {scanResult.socialChannels?.length ? <ul className="mt-2 grid gap-1 font-mono text-caption">{scanResult.socialChannels.slice(0, 8).map((url) => <li key={url} className="truncate"><a href={url} target="_blank" rel="noreferrer" className="text-terminal-green underline">{displayDomain(url)} · open source page</a></li>)}</ul> : <p className="mt-2 font-mono text-caption text-muted-foreground">No public social links found. Connected account data can be added later.</p>}
          </div>
        </div>
      </div>
      <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer font-mono text-caption font-medium">Pages reviewed ({scanResult.pages?.length ?? 0})</summary>
        <ul className="mt-2 grid gap-2">{(scanResult.pages ?? []).map((page) => <li key={page.url} className="min-w-0 border-t pt-2"><a href={page.url} target="_blank" rel="noreferrer" className="break-all font-mono text-caption font-medium text-terminal-green underline">{page.title || page.url}</a>{page.description && <p className="mt-1 font-mono text-caption text-muted-foreground">{page.description}</p>}{page.headings.length > 0 && <p className="mt-1 font-mono text-caption text-muted-foreground">{page.headings.slice(0, 4).join(" · ")}</p>}<p className="mt-1 line-clamp-3 font-mono text-caption text-muted-foreground">{page.excerpt}</p></li>)}</ul>
      </details>
    </section>
  );
}
