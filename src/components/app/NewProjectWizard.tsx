import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ScanResult } from "@/convex/scraping";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  ArrowRight,
  Check,
  Globe,
  Loader2,
  MapPin,
  Plus,
  ScanSearch,
  Sparkles,
  Store,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  displayDomain,
  looksLikeUrl,
  normalizeWebsiteUrl,
} from "@/lib/url";
import { summarizeProjectScan, type ProjectScanSourceStatus } from "@/lib/project-scan-status";

type CompetitorEntry = { type: "website" | "gmb"; value: string };
type BusinessListing = {
  title?: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  category?: string;
  openHours?: string;
};

const steps = [
  { key: "start", label: "Business" },
  { key: "review", label: "Review" },
  { key: "audience", label: "Audience" },
  { key: "draft", label: "First draft" },
] as const;

/* ── Chip input: type + Enter or comma, click ✕ to remove ─────────────── */

function ChipInput({
  values,
  onChange,
  placeholder,
  renderChip,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  renderChip?: (value: string) => React.ReactNode;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim().replace(/,+$/, "");
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };

  return (
    <div className="rounded-md border bg-card p-2">
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Badge
              key={v}
              variant="outline"
              className="gap-1 border-terminal-green/40 bg-terminal-green-soft font-mono text-caption text-terminal-green"
            >
              {renderChip ? renderChip(v) : v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                className="ml-0.5 opacity-70 transition-opacity hover:opacity-100"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        aria-label={placeholder ?? "Add an item"}
        value={draft}
        onChange={(e) => {
          const val = e.target.value;
          // comma commits the chip immediately
          if (val.includes(",")) {
            const parts = val.split(",");
            const head = parts[0].trim();
            if (head && !values.includes(head)) onChange([...values, head]);
            setDraft(parts.slice(1).join(""));
          } else {
            setDraft(val);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={placeholder ?? "Type and press Enter"}
        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
    </div>
  );
}

/* ── Quick-add suggestion row for the interactive "who" step ───────────── */

function Suggestions({
  options,
  picked,
  onPick,
}: {
  options: string[];
  picked: string[];
  onPick: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = picked.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(o)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-caption transition-colors ease-terminal",
              active
                ? "border-terminal-green/60 bg-terminal-green-soft text-terminal-green"
                : "text-muted-foreground hover:border-terminal-green/40 hover:text-terminal-green",
            )}
          >
            {active && <Check className="size-3" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}

const AUDIENCE_SUGGESTIONS = [
  "local customers",
  "online shoppers",
  "B2B decision makers",
  "families",
  "young professionals",
  "small business owners",
  "event planners",
  "tourists",
];

const GOAL_SUGGESTIONS = [
  "grow online sales",
  "get more local customers",
  "build brand awareness",
  "launch subscriptions",
  "improve retention",
  "generate leads",
];

const PAIN_SUGGESTIONS = [
  "hard to find us on Google",
  "too much manual work",
  "high ad costs",
  "unclear messaging",
  "seasonal demand swings",
  "low repeat purchases",
];

function WebsiteMapReview({
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
          <div className="flex items-center gap-2 text-terminal-green"><Sparkles className="size-4" aria-hidden="true" /><span className="font-mono text-caption font-semibold">A first look at your business</span></div>
          <h2 id="website-map-title" className="mt-1 font-sans text-h2 font-semibold">Here’s what we picked up</h2>
          <p className="mt-1 font-sans text-small text-muted-foreground">These details came from the source you chose. Fix anything that’s off before saving.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <h3 className="font-sans text-small font-semibold">Business details</h3>
          <div className="mt-2 grid gap-2 font-sans text-caption">
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
            {!details?.address && !details?.country && !details?.phone && !details?.email && <p className="text-muted-foreground">No extra contact details were found.</p>}
          </div>
          {details?.footerExcerpt && <details className="mt-3 border-t pt-2"><summary className="cursor-pointer font-sans text-caption">View footer text source</summary><p className="mt-2 font-sans text-caption text-muted-foreground">{details.footerExcerpt}</p></details>}
        </div>
        <div className="grid gap-3">
          <div className="rounded-md border p-3">
            <h3 className="font-sans text-small font-semibold">What you offer</h3>
            {scanResult.productsServices?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{scanResult.productsServices.slice(0, 16).map((item) => <Badge key={item} variant="outline" className="font-sans text-caption">{item}</Badge>)}</div> : <p className="mt-2 font-sans text-caption text-muted-foreground">No clear offers found yet.</p>}
          </div>
          <div className="rounded-md border p-3">
            <h3 className="font-sans text-small font-semibold">Social links</h3>
            {scanResult.socialChannels?.length ? <ul className="mt-2 grid gap-1 font-sans text-caption">{scanResult.socialChannels.slice(0, 8).map((url) => <li key={url} className="truncate"><a href={url} target="_blank" rel="noreferrer" className="text-terminal-green underline">{displayDomain(url)} · open link</a></li>)}</ul> : <p className="mt-2 font-sans text-caption text-muted-foreground">No public social links found.</p>}
          </div>
        </div>
      </div>
      {coverage && <details className="rounded-md border px-3 py-2">
        <summary className="cursor-pointer font-sans text-caption font-medium">How we read your site</summary>
        <div className="mt-3 grid gap-2 font-sans text-caption text-muted-foreground">
          {coverage && <p>We read {coverage.scannedPageCount} of {coverage.discoveredPageCount} pages we found.</p>}
          {coverage?.truncated && <p>We stopped after {coverage.pageLimit} pages to keep this first pass quick.</p>}
          {coverage?.failedPageCount ? <p>{coverage.failedPageCount} pages couldn’t be read.</p> : null}
          {coverage?.skippedByRobotsCount ? <p>Some pages asked not to be read, so we skipped them.</p> : null}
          {coverage?.sitemapCount ? <p>We used {coverage.sitemapCount} site map{coverage.sitemapCount === 1 ? "" : "s"} to find pages.</p> : null}
          {(scanResult.pages?.length ?? 0) > 0 && <details className="border-t pt-2"><summary className="cursor-pointer">Pages we checked ({scanResult.pages?.length ?? 0})</summary><ul className="mt-2 grid gap-2">{(scanResult.pages ?? []).map((page) => <li key={page.url} className="min-w-0 border-t pt-2"><a href={page.url} target="_blank" rel="noreferrer" className="break-all font-medium text-terminal-green underline">{page.title || page.url}</a>{page.description && <p className="mt-1">{page.description}</p>}<p className="mt-1 line-clamp-3">{page.excerpt}</p></li>)}</ul></details>}
        </div>
      </details>}
    </section>
  );
}

/* ── The wizard ─────────────────────────────────────────────────────────── */

export function NewProjectWizard() {
  const [step, setStep] = useState(0);
  const [entryMode, setEntryMode] = useState<"website" | "describe" | "google">("website");
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [websiteInput, setWebsiteInput] = useState("");
  const [gmbName, setGmbName] = useState("");
  const [ignoreRobots, setIgnoreRobots] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [productsServices, setProductsServices] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [pains, setPains] = useState<string[]>([]);

  const [isScanning, setIsScanning] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [scanStatus, setScanStatus] = useState<
    "idle" | "scanning" | "scraped" | "partial" | "failed"
  >("idle");
  const [scanSources, setScanSources] = useState<{
    website: ProjectScanSourceStatus;
    business: ProjectScanSourceStatus;
  }>({ website: "not_requested", business: "not_requested" });
  const [businessCandidate, setBusinessCandidate] = useState<BusinessListing | null>(null);

  // scan results kept locally until project creation, then persisted
  const [scanResult, setScanResult] = useState<Partial<Omit<ScanResult, "url" | "scannedAt">> | null>(null);

  const create = useMutation(api.projects.create);
  const createPersona = useMutation(api.personas.create);
  const saveScan = useMutation(api.projects.saveScan);
  const scanWebsite = useAction(api.scraping.scanWebsite);
  const lookupGmb = useAction(api.scraping.lookupGoogleBusiness);
  const navigate = useNavigate();

  const normalizedUrl = normalizeWebsiteUrl(websiteInput);
  const updateBusinessDetail = (field: keyof NonNullable<ScanResult["businessDetails"]>, value: string) => {
    setScanResult((current) => current ? {
      ...current,
      businessDetails: { ...current.businessDetails, [field]: value.trim() || undefined },
    } : current);
    if (field === "name") setBusinessName(value);
  };
  const sourceLabels = [
    scanSources.website === "succeeded" || scanSources.website === "partial" ? "your website" : null,
    scanSources.business === "succeeded" ? "a Google Business result" : null,
  ].filter((label): label is string => label !== null).join(" and ");

  /* Scan the supplied website and search for an optional Google Business listing. */
  const runScan = async () => {
    const jobs: Promise<void>[] = [];
    let scraped = false;
    const scanUrl = normalizedUrl;
    const scanWebsiteRequested = entryMode === "website" && Boolean(scanUrl);
    const lookupBusinessRequested = entryMode === "google" && Boolean(gmbName.trim());
    let websiteStatus: ProjectScanSourceStatus = scanWebsiteRequested ? "failed" : "not_requested";
    let gmbFound = false;
    let discoveredBusinessName = "";
    setScanStatus("scanning");
    setScanResult(null);
    setBusinessCandidate(null);

    if (scanWebsiteRequested && scanUrl) {
      jobs.push(
        scanWebsite({ url: scanUrl, ignoreRobots })
          .then((r) => {
            scraped = true;
            websiteStatus = r.coverage.truncated || r.coverage.failedPageCount > 0 || r.coverage.sitemapFailureCount > 0
              ? "partial"
              : "succeeded";
            setScanResult((prev) => ({ ...r, gmb: prev?.gmb }));
            if (!businessName.trim() && r.businessDetails.name) {
              discoveredBusinessName = r.businessDetails.name;
              setBusinessName(r.businessDetails.name);
              setName(r.businessDetails.name);
            }
            if (!description && r.metaDescription) setDescription(r.metaDescription);
            if (!description && r.titles?.length) setDescription(r.titles[0]);
            setProductsServices((prev) => {
              const merged = new Set([...prev, ...(r.productsServices ?? [])]);
              return [...merged].slice(0, 20);
            });
          })
          .catch(() => undefined),
      );
    }

    if (lookupBusinessRequested) {
      jobs.push(
        lookupGmb({ name: gmbName.trim() })
          .then((g) => {
            gmbFound = true;
            setBusinessCandidate({
              title: g.title,
              address: g.address,
              phone: g.phone,
              website: g.website,
              rating: g.rating,
              reviews: g.reviews,
              category: g.category,
              openHours: g.openHours,
            });
          })
          .catch(() => undefined),
      );
    }

    await Promise.allSettled(jobs);
    const sources = {
      website: scanWebsiteRequested ? (scraped ? websiteStatus : "failed") : "not_requested",
      business: lookupBusinessRequested ? (gmbFound ? "needs_review" : "failed") : "not_requested",
    } as const;
    setScanSources(sources);
    setScanStatus(summarizeProjectScan(sources));
    if (!name.trim() && scanWebsiteRequested) {
      const projectName = discoveredBusinessName || displayDomain(scanUrl ?? "");
      setName(projectName);
      if (!businessName.trim() && discoveredBusinessName) setBusinessName(discoveredBusinessName);
    }
    return scraped || gmbFound;
  };

  const handleBasicsContinue = async () => {
    if (entryMode === "website" && websiteInput.trim() && !normalizedUrl) return;
    if (entryMode === "google" && !gmbName.trim()) return;
    if (entryMode === "describe" && !description.trim()) return;
    const shouldScanWebsite = entryMode === "website" && Boolean(normalizedUrl);
    const shouldLookupBusiness = entryMode === "google" && Boolean(gmbName.trim());
    if (!shouldScanWebsite && !shouldLookupBusiness) {
      setScanResult(null);
      setBusinessCandidate(null);
      setScanSources({ website: "not_requested", business: "not_requested" });
      setScanStatus("idle");
      setStep(1);
      return;
    }
    setIsScanning(true);
    try {
      await runScan();
    } finally {
      setIsScanning(false);
    }
    if (!name.trim() && businessName.trim()) setName(businessName.trim());
    setStep(1);
  };

  const handleContinue = async () => {
    if (step === 0) {
      await handleBasicsContinue();
      return;
    }
    setStep(step + 1);
  };

  const handleFinish = async () => {
    if (!name.trim() || isCreating) return;
    if (scanSources.business === "needs_review") {
      toast.warning("Confirm the Google Business listing or skip it before creating this project.");
      setStep(1);
      return;
    }
    setIsCreating(true);
    try {
      const id = await create({
        name: name.trim(),
        businessName: businessName.trim() || undefined,
        websiteUrl: entryMode === "website"
          ? normalizedUrl ?? scanResult?.gmb?.website ?? undefined
          : entryMode === "google" ? scanResult?.gmb?.website : undefined,
        industry: industry.trim() || undefined,
        description: description.trim() || undefined,
        competitors: competitors.map((c) => c.value),
        competitorEntries: competitors.length ? competitors : undefined,
        googleBusinessName: scanSources.business === "succeeded" && gmbName.trim() ? gmbName.trim() : undefined,
        productsServices: productsServices.length ? productsServices : undefined,
        goals: goals.length ? goals : undefined,
        kpis: undefined,
        channels: undefined,
      });

      let personaSaved = true;
      if (audience.length || goals.length || pains.length) {
        try {
          await createPersona({
            projectId: id,
            name: audience[0] || `${businessName || name} customer`,
            role: audience.join(", ") || undefined,
            goals: goals.length ? goals : undefined,
            pains: pains.length ? pains : undefined,
            evidence: "Based on the audience, goal, and customer challenges you selected during setup.",
          });
        } catch {
          personaSaved = false;
        }
      }

      // Persist scan findings so every module can reuse the enriched context.
      if (scanResult) {
        const status = scanSources.website === "partial" || scanStatus === "partial" ? "partial" : "scraped";
        let saved = true;
        try {
          await saveScan({
            id,
            status,
            sitemapUrls: scanResult.sitemapUrls,
            titles: scanResult.titles,
            metaDescription: scanResult.metaDescription,
            headings: scanResult.headings,
            productsServices: scanResult.productsServices,
            pages: scanResult.pages,
            socialChannels: scanResult.socialChannels,
            businessDetails: scanResult.businessDetails,
            coverage: scanResult.coverage,
            gmb: scanResult.gmb,
          });
        } catch {
          saved = false;
        }
        if (!saved) toast.warning("Project created, but the website findings weren’t saved. You can scan it again in project settings.");
        else toast.success("Your business profile is ready", { description: "Your reviewed details are saved with the workspace." });
      }
      if (!personaSaved) toast.warning("Workspace created, but the audience profile couldn’t be saved. You can add it in Understand.");
      else if (!scanResult && (audience.length || goals.length || pains.length)) toast.success("Workspace and first audience profile are ready");
      else if (!scanResult) toast.success("Workspace created", { description: "You can add an audience profile in Understand whenever you’re ready." });
      navigate(`/app/${id}/understand`);
    } catch (e) {
      toast.error("Could not create project", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-7 grid gap-3">
        <div className="flex justify-end">
          <p className="font-sans text-caption text-muted-foreground">Nothing here is final. Change anything.</p>
        </div>
        <ol aria-label="New project steps" className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-caption text-muted-foreground">
          {steps.map((s, i) => <li key={s.key} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-2", i === step && "font-semibold text-foreground")}>
            <span className={cn("grid size-6 place-items-center rounded-full border", i < step && "border-terminal-green bg-terminal-green-soft text-terminal-green", i === step && "border-terminal-green bg-terminal-green text-background")}>{i < step ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}</span>{s.label}
          </li>)}
        </ol>
      </div>

      {/* ── Step 1: basics — flexible website, GMB, competitors ────────── */}
      {isScanning && (
        <section className="mx-auto grid max-w-xl justify-items-center gap-4 py-16 text-center" role="status" aria-live="polite">
          <Loader2 className="size-8 animate-spin text-terminal-green motion-reduce:animate-none" aria-hidden="true" />
          <div>
            <h1 className="font-sans text-h1 font-semibold">Getting to know your business…</h1>
            <p className="mt-2 font-sans text-small text-muted-foreground">
              {entryMode === "google" ? "Looking for the business listing you named." : `Reading public pages from ${displayDomain(websiteInput)}.`}
            </p>
            <p className="mt-1 font-sans text-caption text-muted-foreground">We’ll show you what we found so you can check it.</p>
          </div>
        </section>
      )}

      {step === 0 && !isScanning && (
        <div className="mx-auto grid w-full max-w-3xl gap-5 rounded-lg border bg-card p-5 sm:p-8">
          <div>
            <span className="mb-2 inline-flex items-center gap-2 font-mono text-caption text-terminal-green"><Sparkles className="size-4" aria-hidden="true" /> A useful first step</span>
            <h1 className="font-sans text-h1 font-semibold">Paste your website. We’ll do the rest.</h1>
            <p className="mt-2 max-w-prose font-sans text-small text-muted-foreground">We’ll draft a business profile from public information. You can review and change every detail before it’s saved.</p>
          </div>

          {entryMode === "website" && <div className="grid gap-2">
            <Label htmlFor="np-url">Your website</Label>
            <Input id="np-url" value={websiteInput} onChange={(event) => setWebsiteInput(event.target.value)} placeholder="example.com" autoFocus className="h-14 text-lg" />
            {websiteInput.trim() !== "" && !normalizedUrl && <p role="alert" className="font-sans text-caption text-destructive">Enter a website address, or choose another way to start.</p>}
            {normalizedUrl && <p className="font-sans text-caption text-muted-foreground">We’ll read public pages from {displayDomain(normalizedUrl)}.</p>}
          </div>}

          {entryMode === "describe" && <div className="grid gap-2">
            <Label htmlFor="np-description">What does your business do?</Label>
            <Textarea id="np-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="I run a neighborhood bakery that makes sourdough and celebration cakes." rows={3} autoFocus />
            <p className="font-sans text-caption text-muted-foreground">A sentence is enough. You can add more later.</p>
          </div>}

          {entryMode === "google" && <div className="grid gap-2">
            <Label htmlFor="np-gmb">Business name and city</Label>
            <div className="flex items-center gap-2"><MapPin className="size-4 shrink-0 text-terminal-green" aria-hidden="true" /><Input id="np-gmb" value={gmbName} onChange={(event) => setGmbName(event.target.value)} placeholder="e.g. Northside Bakery, Amsterdam" autoFocus /></div>
            <p className="font-sans text-caption text-muted-foreground">You’ll confirm the matching listing before MOSAI uses its details.</p>
          </div>}

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button type="button" aria-pressed={entryMode === "website"} variant={entryMode === "website" ? "outline" : "ghost"} onClick={() => setEntryMode("website")}><Globe className="size-4" aria-hidden="true" /> Use a website</Button>
            <Button type="button" aria-pressed={entryMode === "describe"} variant={entryMode === "describe" ? "outline" : "ghost"} onClick={() => setEntryMode("describe")}>No website? Describe it</Button>
            <Button type="button" aria-pressed={entryMode === "google"} variant={entryMode === "google" ? "outline" : "ghost"} onClick={() => setEntryMode("google")}><MapPin className="size-4" aria-hidden="true" /> Find it on Google</Button>
          </div>

          <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer font-sans text-caption font-medium">Add competitors (optional)</summary>
            <p className="mt-2 font-sans text-caption text-muted-foreground">Add website addresses or business names for later comparison.</p>
            <ChipInput values={competitors.map((competitor) => competitor.value)} onChange={(next) => setCompetitors(next.map((value) => competitors.find((item) => item.value.toLowerCase() === value.toLowerCase()) ?? (looksLikeUrl(value) ? { type: "website", value } : { type: "gmb", value })))} placeholder="Website or business name — press Enter" renderChip={(value) => <span className="inline-flex items-center gap-1">{competitors.find((item) => item.value === value)?.type === "gmb" ? <Store className="size-3" aria-hidden="true" /> : <Globe className="size-3" aria-hidden="true" />}{displayDomain(value) || value}</span>} />
          </details>

          {entryMode === "website" && normalizedUrl && <details className="rounded-md border px-3 py-2">
            <summary className="cursor-pointer font-sans text-caption font-medium">Advanced website scan</summary>
            <label className="mt-2 flex items-start gap-2 font-sans text-caption text-muted-foreground"><input type="checkbox" checked={ignoreRobots} onChange={(event) => setIgnoreRobots(event.target.checked)} className="mt-0.5 size-3.5 accent-terminal-green" /><span>Continue through pages that ask crawlers to stay away. Only enable this for a site you control and have permission to scan.</span></label>
          </details>}
        </div>
      )}

      {/* ── Step 2: what — auto-filled from scan ────────────────────────── */}
      {step === 1 && (
        <div className="grid gap-4">
          <div>
            <h1 className="font-sans text-h1 font-semibold">Your business, in a first draft</h1>
            <p className="mt-1 font-sans text-small text-muted-foreground">
              {scanResult
                ? `From ${sourceLabels}. Check anything that looks off.`
                : scanStatus === "failed"
                  ? "We couldn’t read that source. Tell us about your business in your own words instead."
                  : "Add a name and a short description. You can fill in the rest later."}
            </p>
          </div>

          {scanResult && <WebsiteMapReview scanResult={scanResult} businessName={businessName} onBusinessDetailChange={updateBusinessDetail} />}

          {(scanStatus === "scraped" || scanStatus === "partial" || scanStatus === "failed") && (
            <div role="status" className={cn(
              "flex flex-wrap items-center gap-2 rounded-md border p-3 font-mono text-caption",
              scanStatus === "scraped"
                ? "border-terminal-green/30 bg-terminal-green-soft text-terminal-green"
                : "border-border bg-muted/40 text-muted-foreground",
            )}>
              <ScanSearch className="size-4" aria-hidden="true" />
              {scanStatus === "scraped"
              ? "We found details to review."
                : scanStatus === "partial"
                  ? "Review the details and fill in anything missing."
                  : "You can add your details manually below."}
            </div>
          )}

          {businessCandidate && scanSources.business === "needs_review" && (
            <div className="rounded-md border bg-card p-4 font-sans text-small">
              <p className="font-medium">Is this your Google Business listing?</p>
              <p className="mt-1">{businessCandidate.title ?? "Unnamed listing"}</p>
              {businessCandidate.address && <p className="text-muted-foreground">{businessCandidate.address}</p>}
              {businessCandidate.website && <p className="text-muted-foreground">{businessCandidate.website}</p>}
              <p className="mt-2 text-muted-foreground">MOSAI will use this listing only if you confirm it.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => {
                  setScanResult((prev) => ({
                    ...prev,
                    gmb: businessCandidate,
                    businessDetails: {
                      ...prev?.businessDetails,
                      name: businessCandidate.title,
                      address: businessCandidate.address,
                      phone: businessCandidate.phone,
                    },
                  }));
                  if (!businessName.trim() && businessCandidate.title) {
                    setBusinessName(businessCandidate.title);
                    setName(businessCandidate.title);
                  }
                  if (!industry.trim() && businessCandidate.category) setIndustry(businessCandidate.category);
                  const next = { ...scanSources, business: "succeeded" as const };
                  setScanSources(next);
                  setScanStatus(summarizeProjectScan(next));
                  setBusinessCandidate(null);
                }}>Use this listing</Button>
                <Button size="sm" variant="outline" onClick={() => {
                  const next = { ...scanSources, business: "skipped" as const };
                  setScanSources(next);
                  setScanStatus(summarizeProjectScan(next));
                  setBusinessCandidate(null);
                }}>Not my business</Button>
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="np-name">Workspace name</Label>
            <Input id="np-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your business name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-desc">What do you do?</Label>
            <Textarea
              id="np-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Describe what you offer in one or two sentences."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="np-ind">Category (optional)</Label>
              <Input
                id="np-ind"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. DTC coffee"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="np-biz2">Public business name (optional)</Label>
              <Input
                id="np-biz2"
              value={businessName}
                onChange={(e) => updateBusinessDetail("name", e.target.value)}
                placeholder={scanResult?.gmb?.title ?? "Optional"}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Products / services detected</Label>
            <ChipInput
              values={productsServices}
              onChange={setProductsServices}
              placeholder="Add anything we missed — Enter to add"
            />
          </div>
        </div>
      )}

      {/* ── Step 3: who — interactive chip builder ─────────────────────── */}
      {step === 2 && (
        <div className="grid gap-5">
          <div>
            <h1 className="font-sans text-h1 font-semibold">Who do you most want to help?</h1>
            <p className="mt-1 font-sans text-small text-muted-foreground">Choose an audience and one thing you want to improve. These answers shape a first audience profile you can edit later.</p>
          </div>

          <div className="grid gap-2">
            <Label>People you serve</Label>
            <Suggestions
              options={scanResult?.productsServices?.[0]
                ? [`People looking for ${scanResult.productsServices[0]}`, `Local customers interested in ${industry || scanResult.productsServices[0]}`, `People comparing ${scanResult.productsServices[0]} options`]
                : AUDIENCE_SUGGESTIONS.slice(0, 4)}
              picked={audience}
              onPick={(value) => setAudience((current) => current[0] === value ? [] : [value])}
            />
            <ChipInput
              values={audience}
              onChange={(next) => setAudience(next.slice(-1))}
              placeholder="Describe your own audience — Enter to add"
            />
          </div>

          <div className="grid gap-2">
            <Label>What matters most right now?</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {GOAL_SUGGESTIONS.slice(0, 4).map((goal) => <button key={goal} type="button" aria-pressed={goals[0] === goal} onClick={() => setGoals((current) => current[0] === goal ? [] : [goal])} className={cn("rounded-md border p-4 text-left font-sans text-small transition-colors", goals[0] === goal ? "border-terminal-green bg-terminal-green-soft text-foreground" : "bg-card text-muted-foreground hover:border-terminal-green/50 hover:text-foreground")}>
                {goal}
              </button>)}
            </div>
            <ChipInput values={goals} onChange={(next) => setGoals(next.slice(-1))} placeholder="Or type your own goal — press Enter" />
          </div>

          <div className="grid gap-2">
            <Label>What gets in their way? (optional)</Label>
            <Suggestions
              options={PAIN_SUGGESTIONS}
              picked={pains}
              onPick={(v) =>
                setPains((prev) =>
                  prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                )
              }
            />
            <ChipInput values={pains} onChange={setPains} placeholder="Custom pains — Enter to add" />
          </div>
        </div>
      )}

      {step === 3 && (
        <section className="mx-auto grid w-full max-w-3xl gap-5 rounded-lg border bg-card p-5 sm:p-8" aria-labelledby="first-draft-title">
          <div>
            <span className="mb-2 inline-flex items-center gap-2 font-mono text-caption text-terminal-green"><Sparkles className="size-4" aria-hidden="true" /> Your first useful output</span>
            <h1 id="first-draft-title" className="font-sans text-h1 font-semibold">A starting profile for {businessName || name}</h1>
            <p className="mt-2 font-sans text-small text-muted-foreground">Built from what you shared. {audience.length || goals.length || pains.length ? "We’ll save it as an editable audience profile in your workspace." : "You can add these details now or later in Understand."}</p>
          </div>
          <div className="grid gap-4 rounded-md border bg-background p-4 sm:grid-cols-2 sm:p-5">
            <div><p className="font-mono text-caption text-muted-foreground">AUDIENCE</p><p className="mt-1 font-sans text-small font-medium">{audience[0] || "Add an audience anytime"}</p></div>
            <div><p className="font-mono text-caption text-muted-foreground">THEIR MAIN GOAL</p><p className="mt-1 font-sans text-small font-medium">{goals[0] || "Choose a goal anytime"}</p></div>
            {pains.length > 0 && <div><p className="font-mono text-caption text-muted-foreground">WHAT GETS IN THE WAY</p><p className="mt-1 font-sans text-small font-medium">{pains.join(", ")}</p></div>}
            {(productsServices.length > 0 || description) && <div><p className="font-mono text-caption text-muted-foreground">BUSINESS CONTEXT</p><p className="mt-1 font-sans text-small font-medium">{productsServices.slice(0, 3).join(", ") || description}</p></div>}
          </div>
          <p className="font-sans text-caption text-muted-foreground">This is a working draft, not a claim about a real customer. You can change it in Understand.</p>
        </section>
      )}

      {!isScanning && <div className="mt-8 flex items-center gap-3">
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button onClick={handleContinue} disabled={(step === 0 && ((entryMode === "website" && !normalizedUrl) || (entryMode === "describe" && !description.trim()) || (entryMode === "google" && !gmbName.trim()))) || (step === 1 && (!name.trim() || scanSources.business === "needs_review"))}>
            {step === 0 ? entryMode === "website" ? <>Read my website <Sparkles className="size-4" /></> : entryMode === "google" ? <>Find my business <ArrowRight className="size-4" /></> : <>Build my profile <ArrowRight className="size-4" /></> : <>Continue <ArrowRight className="size-4" /></>}
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={!name.trim() || isCreating} className="font-sans">
            {isCreating ? <><Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> Creating your workspace…</> : <><Plus className="size-4" /> Create my workspace</>}
          </Button>
        )}
      </div>}
    </div>
  );
}
