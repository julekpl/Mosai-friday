import { useEffect, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { ChipInput } from "@/components/app/ChipInput";
import { api } from "@/convex/_generated/api";
import type { ScanResult } from "@/convex/scraping";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MOSAI_EASE, MOTION } from "@/components/motion";
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
type BusinessSuggestion = {
  placeId: string;
  title: string;
  address?: string;
  category?: string;
  rating?: number;
  reviews?: number;
};
type BusinessSearchState = "idle" | "loading" | "results" | "empty" | "error";

const steps = [
  { key: "start", label: "Your business", hint: "Name and a starting source" },
  { key: "review", label: "What we found", hint: "Check it is right" },
  { key: "audience", label: "Who you serve", hint: "Audience and goals" },
] as const;

/** Step slide: a short 12px travel in the direction of navigation. The app's
 *  MotionConfig (reducedMotion="user") removes the travel when asked. */
const stepVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 12 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -12 }),
};

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
            className={`font-mono text-caption ${cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors ease-terminal",
              active
                ? "border-terminal-green/60 bg-terminal-green-soft text-terminal-green"
                : "text-muted-foreground hover:border-terminal-green/40 hover:text-terminal-green",
            )}`}
          >
            {active && <Check className="size-3" aria-hidden="true" />}
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

const MARKETING_CHALLENGE_SUGGESTIONS = [
  "hard to find us on Google",
  "too much manual work",
  "high ad costs",
  "unclear messaging",
  "seasonal demand swings",
  "low repeat purchases",
];

function OnboardingPreview({
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

/* ── The wizard ─────────────────────────────────────────────────────────── */

export function NewProjectWizard() {
  const [step, setStepState] = useState(0);
  const [direction, setDirection] = useState(1);
  const stepRegionRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const setStep = (next: number) => {
    setDirection(next >= step ? 1 : -1);
    focusPending.current = next !== step;
    setStepState(next);
  };
  /** After a step change, move focus to the new step's heading so keyboard
   *  and screen-reader users start at the top of the new content. */
  const focusStepHeading = () => {
    const heading = stepRegionRef.current?.querySelector("h1");
    if (heading instanceof HTMLElement) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: false });
    }
  };
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [websiteInput, setWebsiteInput] = useState("");
  const [gmbName, setGmbName] = useState("");
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessSuggestion | null>(null);
  const [businessSuggestions, setBusinessSuggestions] = useState<BusinessSuggestion[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [businessSearchState, setBusinessSearchState] = useState<BusinessSearchState>("idle");
  const suggestionCache = useRef(new Map<string, BusinessSuggestion[]>());
  const [ignoreRobots, setIgnoreRobots] = useState(false);
  const [competitors, setCompetitors] = useState<CompetitorEntry[]>([]);
  const [industry, setIndustry] = useState("");
  const [description, setDescription] = useState("");
  const [productsServices, setProductsServices] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [customerProblems, setCustomerProblems] = useState<string[]>([]);
  const [marketingChallenges, setMarketingChallenges] = useState<string[]>([]);
  const [serviceArea, setServiceArea] = useState("");

  const [isScanning, setIsScanning] = useState(false);
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
  const saveScan = useMutation(api.projects.saveScan);
  const draftBusinessProfile = useAction(api.ai.generateBusinessProfile);
  const scanWebsite = useAction(api.scraping.scanWebsite);
  const lookupGmb = useAction(api.scraping.lookupGoogleBusiness);
  const suggestGmb = useAction(api.scraping.suggestGoogleBusiness);
  const navigate = useNavigate();

  useEffect(() => {
    const query = gmbName.trim();
    if (query.length < 3 || selectedBusiness) return;

    let current = true;
    const cacheKey = query.toLowerCase();
    const cached = suggestionCache.current.get(cacheKey);
    if (cached) {
      setBusinessSuggestions(cached);
      setActiveSuggestionIndex(-1);
      setBusinessSearchState(cached.length ? "results" : "empty");
      return;
    }
    const timeout = window.setTimeout(() => {
      setBusinessSearchState("loading");
      void suggestGmb({ query }).then((suggestions) => {
        // Every search is a paid lookup: never repeat one the user already ran.
        suggestionCache.current.set(cacheKey, suggestions);
        if (!current) return;
        setBusinessSuggestions(suggestions);
        setActiveSuggestionIndex(-1);
        setBusinessSearchState(suggestions.length ? "results" : "empty");
      }).catch(() => {
        if (!current) return;
        setBusinessSuggestions([]);
        setActiveSuggestionIndex(-1);
        setBusinessSearchState("error");
      });
    }, 700);

    return () => {
      current = false;
      window.clearTimeout(timeout);
    };
  }, [gmbName, selectedBusiness, suggestGmb]);

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
    let websiteStatus: ProjectScanSourceStatus = normalizedUrl ? "failed" : "not_requested";
    let gmbFound = false;
    setScanStatus("scanning");
    setScanResult(null);
    setBusinessCandidate(null);

    if (normalizedUrl) {
      jobs.push(
        scanWebsite({ url: normalizedUrl, ignoreRobots })
          .then((r) => {
            scraped = true;
            websiteStatus = r.coverage.truncated || r.coverage.failedPageCount > 0 || r.coverage.sitemapFailureCount > 0
              ? "partial"
              : "succeeded";
            setScanResult((prev) => ({ ...r, gmb: prev?.gmb }));
            if (!businessName.trim() && r.businessDetails.name) setBusinessName(r.businessDetails.name);
            if (!description && r.metaDescription) setDescription(r.metaDescription);
            if (!description && r.titles?.length) setDescription(r.titles[0]);
            setProductsServices((prev) => {
              const merged = new Set([...prev, ...(r.productsServices ?? [])]);
              return [...merged].slice(0, 20);
            });
          })
          .catch((e) => {
            toast.warning("Website scan failed", {
              description: e instanceof Error ? e.message : "Try again later.",
            });
          }),
      );
    }

    if (gmbName.trim()) {
      jobs.push(
        lookupGmb({ name: selectedBusiness?.title ?? gmbName.trim(), placeId: selectedBusiness?.placeId })
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
          .catch((e) => {
            toast.warning("Google Business lookup failed", {
              description: e instanceof Error ? e.message : "Try again later.",
            });
          }),
      );
    }

    await Promise.allSettled(jobs);
    const sources = {
      website: normalizedUrl ? (scraped ? websiteStatus : "failed") : "not_requested",
      business: gmbName.trim() ? (gmbFound ? "needs_review" : "failed") : "not_requested",
    } as const;
    setScanSources(sources);
    setScanStatus(summarizeProjectScan(sources));
    return scraped || gmbFound;
  };

  const handleBasicsContinue = async () => {
    if (!name.trim()) return;
    if (!normalizedUrl && !gmbName.trim()) {
      setScanResult(null);
      setBusinessCandidate(null);
      setScanSources({ website: "not_requested", business: "not_requested" });
      setScanStatus("idle");
      setStep(1); // nothing to scan
      return;
    }
    setIsScanning(true);
    try {
      await runScan();
    } finally {
      setIsScanning(false);
    }
    setStep(1);
  };

  const handleContinue = async () => {
    if (step === 0) {
      await handleBasicsContinue();
      return;
    }
    setStep(step + 1);
  };

  /** Enter in the first-step text fields moves on, like submitting a form. */
  const continueOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (!name.trim() || isScanning) return;
    event.preventDefault();
    void handleContinue();
  };

  const handleFinish = async () => {
    if (!name.trim()) return;
    if (scanSources.business === "needs_review") {
      toast.warning("Confirm the Google Business listing or skip it before creating this project.");
      setStep(1);
      return;
    }
    try {
      const id = await create({
        name: name.trim(),
        businessName: businessName.trim() || undefined,
        websiteUrl: normalizedUrl ?? scanResult?.gmb?.website ?? undefined,
        industry: industry.trim() || undefined,
        description: description.trim() || undefined,
        competitors: competitors.map((c) => c.value),
        competitorEntries: competitors.length ? competitors : undefined,
        googleBusinessName: scanSources.business === "succeeded" && gmbName.trim() ? gmbName.trim() : undefined,
        productsServices: productsServices.length ? productsServices : undefined,
        goals: goals.length ? goals : undefined,
        targetAudience: audience.length ? audience : undefined,
        customerPains: customerProblems.length ? customerProblems : undefined,
        marketingChallenges: marketingChallenges.length ? marketingChallenges : undefined,
        serviceArea: serviceArea.trim() || undefined,
      });

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
        if (!saved) toast.warning("Project created, but the website findings weren’t saved. You can scan it again from Edit project.");
      }
      // Draft the business understanding on the server; the owner reviews it
      // on Overview. It runs in the background and never blocks navigation.
      void draftBusinessProfile({ projectId: id }).catch(() => undefined);
      toast.success("Project created", {
        description: "MOSAI is drafting a summary of your business. Check it on the next screen — everything else builds on it.",
      });
      navigate(`/app/${id}`);
    } catch (e) {
      toast.error("Could not create project", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-caption text-muted-foreground">
            Step {step + 1} of {steps.length} <span aria-hidden="true">·</span> {steps[step].label}
          </p>
          <p className="font-mono text-caption text-terminal-green-ink">A little context now makes every next step more useful.</p>
        </div>
        <div
          role="progressbar"
          aria-label="New project progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={step + 1}
          aria-valuetext={`Step ${step + 1} of ${steps.length}: ${steps[step].label}`}
          className="grid grid-cols-3 gap-1.5"
        >
          {steps.map((s, i) => (
            <span key={s.key} aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className={cn(
                  "block h-full origin-left rounded-full bg-terminal-green transition-transform duration-300 ease-terminal",
                  i <= step ? "scale-x-100" : "scale-x-0",
                )}
              />
            </span>
          ))}
        </div>
        <ol aria-label="New project steps" className="grid gap-2 sm:grid-cols-3">
          {steps.map((s, i) => (
            <li
              key={s.key}
              aria-current={i === step ? "step" : undefined}
              className={`font-mono text-caption ${cn(
                "flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2 transition-colors duration-200 ease-terminal",
                i === step ? "border-terminal-green/40 bg-card shadow-soft" : "border-transparent text-muted-foreground",
              )}`}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border font-semibold transition-colors duration-200",
                  i < step && "border-terminal-green/50 bg-terminal-green-soft text-terminal-green-ink",
                  i === step && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {i < step ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
                {i < step && <span className="sr-only">Done:</span>}
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate", i === step && "font-semibold text-foreground")}>{s.label}</span>
                <span className="hidden truncate text-muted-foreground sm:block">{s.hint}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">
          {`Step ${step + 1} of ${steps.length}: ${steps[step].label}`}
        </p>
      </div>

      <div ref={stepRegionRef}>
      <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={step}
        custom={direction}
        variants={stepVariants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: MOTION.base, ease: MOSAI_EASE }}
        onAnimationComplete={(definition) => {
          if (definition === "center" && focusPending.current) {
            focusPending.current = false;
            focusStepHeading();
          }
        }}
      >
      {/* ── Step 1: a quick, friendly business starting point ─────────── */}
      {step === 0 && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,.9fr)]">
          <section className="grid gap-5 rounded-lg border bg-card p-5 shadow-card sm:p-7" aria-labelledby="business-start-title">
            <div>
              <span className="mb-2 inline-flex items-center gap-2 rounded-full bg-tile-coral-soft px-3 py-1 font-mono text-caption text-foreground"><Sparkles className="size-3.5 text-tile-coral" aria-hidden="true" /> YOUR FIRST WIN STARTS HERE</span>
              <h1 id="business-start-title" className="mt-2 font-mono text-h1">Let’s get your business in focus.</h1>
              <p className="mt-2 max-w-prose font-mono text-caption text-muted-foreground">Give MOSAI one place to start. We’ll gather a first draft from public information—you can check and fix it before it shapes your workspace.</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="np-name">What should we call your workspace?</Label>
              <Input
                id="np-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Northside Coffee"
                onKeyDown={continueOnEnter}
                autoFocus
                aria-describedby="np-name-hint"
                className="h-12 text-small"
              />
              <p id="np-name-hint" className="font-mono text-caption text-muted-foreground">This is your private workspace name. Change it whenever you like.</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="np-url">Your website <span className="font-normal text-muted-foreground">(recommended)</span></Label>
              <div className="relative">
                <Globe className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="np-url"
                  value={websiteInput}
                  onChange={(e) => setWebsiteInput(e.target.value)}
                  placeholder="yourbusiness.com"
                  onKeyDown={continueOnEnter}
                  className="h-12 pl-10"
                  aria-describedby="np-url-hint"
                  inputMode="url"
                />
              </div>
              <p id="np-url-hint" className="font-mono text-caption text-muted-foreground">
                {websiteInput.trim() === "" ? "We’ll look for your offers, key pages, and public links." : normalizedUrl ? (
                  <span className="text-terminal-green">Ready to look at {displayDomain(normalizedUrl)}.</span>
                ) : (
                  <span className="text-terminal-amber">Enter a website like yourbusiness.com.</span>
                )}
              </p>
            </div>

            <details className="group rounded-md border bg-background px-4 py-3">
              <summary className="flex cursor-pointer list-none items-center gap-3 font-mono text-small font-medium [&::-webkit-details-marker]:hidden">
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-tile-sky-soft text-tile-sky"><MapPin className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1"><span className="block">No website? Try your business listing</span><span className="mt-0.5 block font-mono text-caption font-normal text-muted-foreground">Optional · we’ll ask you to confirm the match</span></span>
                <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <div className="mt-3 grid gap-2 border-t pt-3">
                <Label htmlFor="np-gmb">Business name and city</Label>
                <Input
                  id="np-gmb"
                  value={gmbName}
                  onChange={(e) => {
                    setGmbName(e.target.value);
                    setSelectedBusiness(null);
                    setBusinessSuggestions([]);
                    setActiveSuggestionIndex(-1);
                    setBusinessSearchState("idle");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && businessSuggestions.length) {
                      event.preventDefault();
                      setActiveSuggestionIndex((index) => Math.min(index + 1, businessSuggestions.length - 1));
                    } else if (event.key === "ArrowUp" && businessSuggestions.length) {
                      event.preventDefault();
                      setActiveSuggestionIndex((index) => Math.max(index - 1, 0));
                    } else if (event.key === "Enter" && activeSuggestionIndex >= 0) {
                      event.preventDefault();
                      const suggestion = businessSuggestions[activeSuggestionIndex];
                      if (suggestion) {
                        setSelectedBusiness(suggestion);
                        setGmbName(suggestion.title);
                        setBusinessSuggestions([]);
                        setActiveSuggestionIndex(-1);
                        setBusinessSearchState("idle");
                      }
                    } else if (event.key === "Escape") {
                      setBusinessSuggestions([]);
                      setActiveSuggestionIndex(-1);
                      setBusinessSearchState("idle");
                    }
                  }}
                  placeholder="e.g. Northside Coffee, Bristol"
                  className="h-11"
                  autoComplete="off"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={businessSuggestions.length > 0}
                  aria-controls="np-gmb-suggestions"
                  aria-activedescendant={activeSuggestionIndex >= 0 ? `np-gmb-suggestion-${activeSuggestionIndex}` : undefined}
                  aria-describedby="np-gmb-hint np-gmb-search-status"
                />
                <p id="np-gmb-hint" className="font-mono text-caption text-muted-foreground">Suggestions appear as you type. Choose a match, then review it before it’s used.</p>
                <div id="np-gmb-search-status" role="status" aria-live="polite" className="font-mono text-caption text-muted-foreground">
                  {businessSearchState === "loading" && "Searching Google Maps…"}
                  {businessSearchState === "empty" && "No matches found. Try adding a city or checking the spelling."}
                  {businessSearchState === "error" && "Couldn’t load suggestions. You can still continue with this search and review the result."}
                </div>
                {selectedBusiness && <div className="flex items-start gap-2 rounded-md border border-terminal-green/30 bg-terminal-green-soft p-3 font-mono text-caption" role="status">
                  <Check className="mt-0.5 size-4 shrink-0 text-terminal-green" aria-hidden="true" />
                  <span><strong className="font-semibold">Candidate selected:</strong> {selectedBusiness.title}. You’ll still confirm it in the next step.</span>
                </div>}
                {businessSuggestions.length > 0 && <div id="np-gmb-suggestions" role="listbox" aria-label="Google Business suggestions" className="grid gap-1 rounded-md border bg-background p-1">
                  {businessSuggestions.map((suggestion, index) => <button
                    key={suggestion.placeId}
                    id={`np-gmb-suggestion-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === activeSuggestionIndex}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelectedBusiness(suggestion);
                      setGmbName(suggestion.title);
                      setBusinessSuggestions([]);
                      setActiveSuggestionIndex(-1);
                      setBusinessSearchState("idle");
                    }}
                    className={cn("w-full rounded-sm px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", index === activeSuggestionIndex && "bg-muted")}
                  >
                    <span className="block truncate font-mono text-caption font-semibold">{suggestion.title}</span>
                    {suggestion.address && <span className="mt-0.5 block truncate font-mono text-caption text-muted-foreground">{suggestion.address}</span>}
                    {(suggestion.category || suggestion.rating != null) && <span className="mt-0.5 block font-mono text-caption text-muted-foreground">{[suggestion.category, suggestion.rating != null ? `${suggestion.rating}★${suggestion.reviews != null ? ` · ${suggestion.reviews} reviews` : ""}` : null].filter(Boolean).join(" · ")}</span>}
                  </button>)}
                </div>}
              </div>
            </details>

            <details className="rounded-md border px-4 py-3">
              <summary className="cursor-pointer font-mono text-caption font-medium">Add competitors or scan settings <span className="font-normal text-muted-foreground">(optional)</span></summary>
              <div className="mt-3 grid gap-4 border-t pt-3">
                <div className="grid gap-2">
                  <Label htmlFor="np-competitors">Businesses you’d like to keep an eye on</Label>
                  <p className="font-mono text-caption text-muted-foreground">Add a website or a business name and city. You can do this later too.</p>
                  <ChipInput
                    id="np-competitors"
                    values={competitors.map((c) => c.value)}
                    onChange={(next) => {
                      const nextEntries: CompetitorEntry[] = next.map((v) => {
                        const existing = competitors.find((c) => c.value.toLowerCase() === v.toLowerCase());
                        return existing ?? (looksLikeUrl(v) ? { type: "website", value: v } : { type: "gmb", value: v });
                      });
                      setCompetitors(nextEntries);
                    }}
                    placeholder="Add a website or business name, then press Enter"
                    renderChip={(v) => {
                      const entry = competitors.find((c) => c.value.toLowerCase() === v.toLowerCase());
                      return <span className="inline-flex items-center gap-1">{entry?.type === "gmb" ? <Store className="size-3" /> : <Globe className="size-3" />}{displayDomain(v) || v}</span>;
                    }}
                  />
                </div>
                {normalizedUrl && (
                  <label className="flex items-start gap-3 border-t pt-3 font-mono text-caption text-muted-foreground">
                    <input type="checkbox" checked={ignoreRobots} onChange={(e) => setIgnoreRobots(e.target.checked)} className="mt-0.5 size-4 accent-terminal-green" />
                    <span><span className="font-medium text-foreground">I own this website and have permission to scan pages blocked by robots.txt</span><br />Leave this off unless you control the site.</span>
                  </label>
                )}
              </div>
            </details>
          </section>

          <OnboardingPreview
            workspaceName={name}
            website={normalizedUrl}
            listingQuery={gmbName}
            listingSelected={Boolean(selectedBusiness)}
          />
        </div>
      )}

      {/* ── Step 2: what — auto-filled from scan ────────────────────────── */}
      {step === 1 && (
        <div className="grid gap-4 rounded-xl border bg-card p-5 shadow-soft sm:p-7">
          <div>
            <h1 className="font-mono text-h1">What does the business do?</h1>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              {scanResult
                ? `Based on ${sourceLabels}. Review and edit every detail before using it.`
                : "No scan details were added. Describe your business in your own words."}
            </p>
          </div>

          {scanResult && <WebsiteMapReview scanResult={scanResult} businessName={businessName} onBusinessDetailChange={updateBusinessDetail} />}

          {(scanStatus === "scraped" || scanStatus === "partial" || scanStatus === "failed") && (
            <div role="status" className={`font-mono text-caption ${cn(
              "flex flex-wrap items-center gap-2 rounded-md border p-3",
              scanStatus === "scraped"
                ? "border-terminal-green/30 bg-terminal-green-soft text-terminal-green"
                : "border-terminal-amber/30 bg-terminal-amber-soft text-terminal-amber",
            )}`}>
              <ScanSearch className="size-4" />
              {scanStatus === "scraped"
              ? "Sources ready to review"
                : scanStatus === "partial"
                  ? "Some source details need your review. You can continue with what was found."
                  : "Sources could not be loaded. You can still add the details yourself."}
              {scanSources.website !== "not_requested" && (
                <span>Website: {scanSources.website === "succeeded" ? `${scanResult?.coverage?.scannedPageCount ?? 0} pages read` : scanSources.website === "partial" ? `${scanResult?.coverage?.scannedPageCount ?? 0} pages read · partial` : "unavailable"}</span>
              )}
              {scanSources.business !== "not_requested" && (
                <span>Google Business: {scanSources.business === "succeeded"
                  ? "confirmed"
                  : scanSources.business === "needs_review"
                    ? "confirm match"
                    : scanSources.business === "skipped"
                      ? "skipped"
                      : "unavailable"}</span>
              )}
              {scanResult?.sitemapUrls?.length ? (
                <Badge variant="outline" className="font-mono text-caption">
                  {scanResult.sitemapUrls.length} sitemap URLs
                </Badge>
              ) : null}
              {scanResult?.gmb?.rating != null && (
                <Badge variant="outline" className="font-mono text-caption">
                  Google {scanResult.gmb.rating}★ ({scanResult.gmb.reviews ?? 0})
                </Badge>
              )}
            </div>
          )}

          {businessCandidate && scanSources.business === "needs_review" && (
            <div className="rounded-md border border-terminal-amber/40 bg-terminal-amber-soft p-3 font-mono text-caption">
              <p className="font-medium">Is this your Google Business listing?</p>
              <p className="mt-1">{businessCandidate.title ?? "Unnamed listing"}</p>
              {businessCandidate.address && <p className="text-muted-foreground">{businessCandidate.address}</p>}
              {businessCandidate.website && <p className="text-muted-foreground">{businessCandidate.website}</p>}
              <p className="mt-2 text-muted-foreground">We will use this listing only if you confirm it.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => {
                  setScanResult((prev) => ({ ...prev, gmb: businessCandidate }));
                  if (!businessName.trim() && businessCandidate.title) setBusinessName(businessCandidate.title);
                  if (!description.trim() && businessCandidate.title) setDescription(businessCandidate.title);
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
            <Label htmlFor="np-desc">Description</Label>
            <Textarea
              id="np-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="One or two honest sentences."
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="np-ind">Industry</Label>
              <Input
                id="np-ind"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="e.g. DTC coffee"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="np-biz2">Business name</Label>
              <Input
                id="np-biz2"
              value={businessName}
                onChange={(e) => updateBusinessDetail("name", e.target.value)}
                placeholder={scanResult?.gmb?.title ?? "Optional"}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="np-offerings">What customers pay you for</Label>
            <ChipInput
              id="np-offerings"
              values={productsServices}
              onChange={setProductsServices}
              placeholder="Add anything we missed — Enter to add"
            />
          </div>
        </div>
      )}

      {/* ── Step 3: who — interactive chip builder ─────────────────────── */}
      {step === 2 && (
        <div className="grid gap-5 rounded-xl border bg-card p-5 shadow-soft sm:p-7">
          <div>
            <h1 className="font-mono text-h1">Who are you trying to reach?</h1>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              Tap what fits — no typing needed unless you want to.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="np-audience">Who pays you? Your customers</Label>
            <p id="np-audience-help" className="font-mono text-caption text-muted-foreground">
              The people or organisations who buy from you — not your team. Be specific, e.g. “homeowners planning an extension”.
            </p>
            <Suggestions
              options={AUDIENCE_SUGGESTIONS}
              picked={audience}
              onPick={(v) =>
                setAudience((prev) =>
                  prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                )
              }
            />
            <ChipInput
              id="np-audience"
              ariaDescribedBy="np-audience-help"
              values={audience}
              onChange={setAudience}
              placeholder="Describe a customer group — Enter to add"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="np-problems">What problems do customers come to you with?</Label>
            <p id="np-problems-help" className="font-mono text-caption text-muted-foreground">
              In their words, e.g. “not sure what planning permission we need”. This steers personas and content.
            </p>
            <ChipInput
              id="np-problems"
              ariaDescribedBy="np-problems-help"
              values={customerProblems}
              onChange={setCustomerProblems}
              placeholder="Add a customer problem — Enter to add"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="np-area">Where are your customers?</Label>
            <Input
              id="np-area"
              value={serviceArea}
              onChange={(e) => setServiceArea(e.target.value)}
              placeholder="e.g. Kraków and surroundings, all of Poland, EU-wide online"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="np-goals">Your business goals</Label>
            <Suggestions
              options={GOAL_SUGGESTIONS}
              picked={goals}
              onPick={(v) =>
                setGoals((prev) =>
                  prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                )
              }
            />
            <ChipInput id="np-goals" values={goals} onChange={setGoals} placeholder="Custom goals — Enter to add" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="np-challenges">What’s holding your marketing back? (optional)</Label>
            <Suggestions
              options={MARKETING_CHALLENGE_SUGGESTIONS}
              picked={marketingChallenges}
              onPick={(v) =>
                setMarketingChallenges((prev) =>
                  prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                )
              }
            />
            <ChipInput
              id="np-challenges"
              values={marketingChallenges}
              onChange={setMarketingChallenges}
              placeholder="Anything else — Enter to add"
            />
          </div>
        </div>
      )}

      </motion.div>
      </AnimatePresence>
      </div>

      <div className="sticky bottom-0 z-10 mt-8 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 shadow-soft surface-glass sm:mx-0">
        {isScanning && <span className="sr-only" role="status">Mapping your business. This can take a little while.</span>}
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button onClick={handleContinue} disabled={step === 0 && (!name.trim() || isScanning)}>
            {isScanning ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Mapping your business…
              </>
            ) : step === 0 ? (
              <>
                {normalizedUrl || gmbName.trim() ? "Find my business details" : "Continue with my business name"} <ArrowRight className="size-4" />
              </>
            ) : (
              <>
                Continue <ArrowRight className="size-4" />
              </>
            )}
          </Button>
        ) : (
          <Button onClick={handleFinish} disabled={!name.trim()}>
            <Plus className="size-4" /> Create project
          </Button>
        )}
        <p className="font-mono text-caption text-muted-foreground sm:ml-auto">
          {step === 0 && name.trim() && !isScanning ? (
            <>Press <kbd className="rounded-sm border bg-card px-1 font-mono text-caption">Enter</kbd> to continue · </>
          ) : null}
          Your details stay a draft until you review them.
        </p>
      </div>
    </div>
  );
}
