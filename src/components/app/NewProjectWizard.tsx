import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
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
  Store,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
  { key: "basics", label: "1. basics" },
  { key: "what", label: "2. what" },
  { key: "who", label: "3. who" },
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

/* ── The wizard ─────────────────────────────────────────────────────────── */

export function NewProjectWizard() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [websiteInput, setWebsiteInput] = useState("");
  const [hasGmb, setHasGmb] = useState(false);
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
  const [scanStatus, setScanStatus] = useState<
    "idle" | "scanning" | "scraped" | "partial" | "failed"
  >("idle");
  const [scanSources, setScanSources] = useState<{
    website: ProjectScanSourceStatus;
    business: ProjectScanSourceStatus;
  }>({ website: "not_requested", business: "not_requested" });
  const [businessCandidate, setBusinessCandidate] = useState<BusinessListing | null>(null);

  // scan results kept locally until project creation, then persisted
  const [scanResult, setScanResult] = useState<{
    sitemapUrls?: string[];
    titles?: string[];
    metaDescription?: string;
    headings?: string[];
    productsServices?: string[];
    gmb?: BusinessListing;
  } | null>(null);

  const create = useMutation(api.projects.create);
  const saveScan = useMutation(api.projects.saveScan);
  const scanWebsite = useAction(api.scraping.scanWebsite);
  const lookupGmb = useAction(api.scraping.lookupGoogleBusiness);
  const navigate = useNavigate();

  const normalizedUrl = normalizeWebsiteUrl(websiteInput);
  const sourceLabels = [
    scanSources.website === "succeeded" ? "your website" : null,
    scanSources.business === "succeeded" ? "a Google Business result" : null,
  ].filter((label): label is string => label !== null).join(" and ");

  /* Run scraper + SerpApi GMB lookup, then prefill the "what" step. */
  const runScan = async () => {
    const jobs: Promise<void>[] = [];
    let scraped = false;
    let gmbFound = false;
    setScanStatus("scanning");
    setScanResult(null);
    setBusinessCandidate(null);

    if (normalizedUrl) {
      jobs.push(
        scanWebsite({ url: normalizedUrl, ignoreRobots })
          .then((r) => {
            scraped = true;
            setScanResult((prev) => ({
              ...prev,
              sitemapUrls: r.sitemapUrls,
              titles: r.titles,
              metaDescription: r.metaDescription,
              headings: r.headings,
              productsServices: r.productsServices,
            }));
            if (!description && r.metaDescription) setDescription(r.metaDescription);
            if (!description && r.titles?.length) setDescription(r.titles[0]);
            if (!industry && r.productsServices?.length) {
              // leave industry to GMB category or user; products fill below
            }
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

    if (hasGmb && gmbName.trim()) {
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
          .catch((e) => {
            toast.warning("Google Business lookup failed", {
              description: e instanceof Error ? e.message : "Try again later.",
            });
          }),
      );
    }

    await Promise.allSettled(jobs);
    const sources = {
      website: normalizedUrl ? (scraped ? "succeeded" : "failed") : "not_requested",
      business: hasGmb ? (gmbFound ? "needs_review" : "failed") : "not_requested",
    } as const;
    setScanSources(sources);
    setScanStatus(summarizeProjectScan(sources));
    return scraped || gmbFound;
  };

  const handleBasicsContinue = async () => {
    if (!name.trim()) return;
    if (hasGmb && !gmbName.trim()) {
      toast.warning("Enter the business name to look up, or turn off Google Business lookup.");
      return;
    }
    if (!normalizedUrl && !hasGmb) {
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
        kpis: undefined,
        channels: undefined,
      });

      // Persist scan findings so every module can reuse the enriched context.
      if (scanResult) {
        const status = scanStatus === "scraped" ? "scraped" : "partial";
        try {
          await saveScan({
            id,
            status,
            sitemapUrls: scanResult.sitemapUrls,
            titles: scanResult.titles,
            metaDescription: scanResult.metaDescription,
            headings: scanResult.headings,
            productsServices: scanResult.productsServices,
            gmb: scanResult.gmb,
          });
        } catch {
          /* scan persistence is best-effort */
        }
      }

      toast.success("Project created", {
        description: "Start in Understand — build your first persona.",
      });
      navigate(`/app/${id}/understand`);
    } catch (e) {
      toast.error("Could not create project", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-2 font-mono text-caption text-muted-foreground">
        {steps.map((s, i) => (
          <span key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full border px-2 py-0.5",
                i === step
                  ? "border-terminal-green/60 bg-terminal-green-soft text-terminal-green"
                  : "border-border",
              )}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <span>—</span>}
          </span>
        ))}
      </div>

      {/* ── Step 1: basics — flexible website, GMB, competitors ────────── */}
      {step === 0 && (
        <div className="grid gap-4">
          <div>
            <h1 className="font-mono text-h1">New project</h1>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              Give us your website — any format — and we'll scan it for you.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="np-name">Project name</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nord Coffee Roasters"
              autoFocus
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="np-url">Website</Label>
            <Input
              id="np-url"
              value={websiteInput}
              onChange={(e) => setWebsiteInput(e.target.value)}
              placeholder="wp.pl · www.wp.pl · https://wp.pl — all fine"
            />
            {websiteInput.trim() !== "" && (
              <p className="font-mono text-caption text-muted-foreground">
                {normalizedUrl ? (
                  <span className="text-terminal-green">
                    will scan: {normalizedUrl}
                  </span>
                ) : (
                  <span className="text-terminal-amber">
                    doesn't look like a website URL yet
                  </span>
                )}
              </p>
            )}
          </div>

          <label className="flex items-center gap-3 rounded-md border bg-card p-3">
            <MapPin className="size-4 shrink-0 text-terminal-green" />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-small font-medium">
                Google Business profile
              </span>
              <span className="block font-mono text-caption text-muted-foreground">
                We'll fetch extra data (address, rating, hours) via SerpApi
              </span>
            </span>
            <Switch checked={hasGmb} onCheckedChange={setHasGmb} />
          </label>
          {hasGmb && (
            <div className="grid gap-2">
              <Label htmlFor="np-gmb">Business name on Google</Label>
              <Input
                id="np-gmb"
                value={gmbName}
                onChange={(e) => setGmbName(e.target.value)}
                placeholder="e.g. Nord Coffee Roasters Kraków"
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="np-comp">Competitors — websites or business names</Label>
            <ChipInput
              values={competitors.map((c) => c.value)}
              onChange={(next) => {
                // rebuild preserving detected types for kept entries
                const nextEntries: CompetitorEntry[] = next.map((v) => {
                  const existing = competitors.find(
                    (c) => c.value.toLowerCase() === v.toLowerCase(),
                  );
                  return existing ?? (looksLikeUrl(v) ? { type: "website", value: v } : { type: "gmb", value: v });
                });
                setCompetitors(nextEntries);
              }}
              placeholder="shopify.com, Local Coffee Bar — Enter to add"
              renderChip={(v) => {
                const entry = competitors.find(
                  (c) => c.value.toLowerCase() === v.toLowerCase(),
                );
                return (
                  <span className="inline-flex items-center gap-1">
                    {entry?.type === "gmb" ? (
                      <Store className="size-3" />
                    ) : (
                      <Globe className="size-3" />
                    )}
                    {displayDomain(v) || v}
                  </span>
                );
              }}
            />
          </div>

          {normalizedUrl && (
            <label className="flex items-center gap-2 font-mono text-caption text-muted-foreground">
              <input
                type="checkbox"
                checked={ignoreRobots}
                onChange={(e) => setIgnoreRobots(e.target.checked)}
                className="size-3.5 accent-terminal-green"
              />
              ignore robots.txt while scanning
            </label>
          )}
        </div>
      )}

      {/* ── Step 2: what — auto-filled from scan ────────────────────────── */}
      {step === 1 && (
        <div className="grid gap-4">
          <div>
            <h1 className="font-mono text-h1">What does the business do?</h1>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              {scanResult
                ? `Based on ${sourceLabels}. Review and edit every detail before using it.`
                : "No scan details were added. Describe your business in your own words."}
            </p>
          </div>

          {(scanStatus === "scraped" || scanStatus === "partial" || scanStatus === "failed") && (
            <div role="status" className={cn(
              "flex flex-wrap items-center gap-2 rounded-md border p-3 font-mono text-caption",
              scanStatus === "scraped"
                ? "border-terminal-green/30 bg-terminal-green-soft text-terminal-green"
                : "border-terminal-amber/30 bg-terminal-amber-soft text-terminal-amber",
            )}>
              <ScanSearch className="size-4" />
              {scanStatus === "scraped"
                ? "Requested sources loaded"
                : scanStatus === "partial"
                  ? "Some source details need your review. You can continue with the available details."
                  : "Sources could not be loaded. You can enter the details yourself."}
              {scanSources.website !== "not_requested" && (
                <span>Website: {scanSources.website === "succeeded" ? "loaded" : "unavailable"}</span>
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
                  GMB {scanResult.gmb.rating}★ ({scanResult.gmb.reviews ?? 0})
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
                onChange={(e) => setBusinessName(e.target.value)}
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
            <h1 className="font-mono text-h1">Who are you trying to reach?</h1>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              Tap what fits — no typing needed unless you want to.
            </p>
          </div>

          <div className="grid gap-2">
            <Label>Audience</Label>
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
              values={audience}
              onChange={setAudience}
              placeholder="Describe your own audience — Enter to add"
            />
          </div>

          <div className="grid gap-2">
            <Label>Goals</Label>
            <Suggestions
              options={GOAL_SUGGESTIONS}
              picked={goals}
              onPick={(v) =>
                setGoals((prev) =>
                  prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                )
              }
            />
            <ChipInput values={goals} onChange={setGoals} placeholder="Custom goals — Enter to add" />
          </div>

          <div className="grid gap-2">
            <Label>Customer pains</Label>
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

      <div className="mt-8 flex items-center gap-3">
        {step > 0 && (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button onClick={handleContinue} disabled={step === 0 && (!name.trim() || isScanning)}>
            {isScanning ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Scanning…
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
        <Badge variant="outline" className="ml-auto font-mono text-caption">
          all fields optional except name
        </Badge>
      </div>
    </div>
  );
}
