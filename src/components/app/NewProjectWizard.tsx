import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { ScanResult } from "@/convex/scraping";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MOSAI_EASE, MOTION } from "@/components/motion";
import { defaultGoalFor, type BusinessType, type PrimaryGoal } from "@/shared/starterKit";
import { classifySource } from "@/components/app/wizard/classifySource";
import type { BusinessListing, BusinessSuggestion } from "@/components/app/wizard/types";
import { BusinessTypeQuestion } from "@/components/app/wizard/BusinessTypeQuestion";
import { NameQuestion } from "@/components/app/wizard/NameQuestion";
import { GoalQuestion } from "@/components/app/wizard/GoalQuestion";

/** First run: three questions, one per screen (first-run blueprint §2–§3). */
const steps = [
  { key: "type", label: "Kind of business" },
  { key: "name", label: "Name" },
  { key: "goal", label: "What you want most" },
] as const;

/** Step slide: a short 12px travel in the direction of navigation. The app's
 *  MotionConfig (reducedMotion="user") removes the travel when asked. */
const stepVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 12 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -12 }),
};

type WebsiteScan = Omit<ScanResult, "url" | "scannedAt">;
/** What the sources produced, gathered in the background after Q2. */
type SourceFindings = {
  website: WebsiteScan | null;
  websitePartial: boolean;
  listing: BusinessListing | null;
};

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
   *  and screen-reader users start at the top of the new content (T1.8). */
  const focusStepHeading = () => {
    const heading = stepRegionRef.current?.querySelector("h1");
    if (heading instanceof HTMLElement) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: false });
    }
  };

  const [businessType, setBusinessType] = useState<BusinessType | undefined>();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessSuggestion | null>(null);
  const [primaryGoal, setPrimaryGoal] = useState<PrimaryGoal | undefined>();
  const [creating, setCreating] = useState(false);

  // The source is read in the background once the owner leaves Q2, so the
  // result is usually ready by the time they finish Q3. Keyed so going back
  // and changing the answer starts a fresh read, and an unchanged answer is
  // never read (or paid for) twice.
  const findings = useRef<{ key: string; promise: Promise<SourceFindings> } | null>(null);

  const create = useMutation(api.projects.create);
  const saveScan = useMutation(api.projects.saveScan);
  const startKit = useMutation(api.starterKit.start);
  const draftBusinessProfile = useAction(api.ai.generateBusinessProfile);
  const scanWebsite = useAction(api.scraping.scanWebsite);
  const lookupGmb = useAction(api.scraping.lookupGoogleBusiness);
  const navigate = useNavigate();

  const classified = classifySource(source);

  const readSources = (): Promise<SourceFindings> => {
    const key = classified.kind === "website"
      ? `web:${classified.url}`
      : selectedBusiness ? `place:${selectedBusiness.placeId}` : "none";
    if (findings.current?.key === key) return findings.current.promise;
    let promise: Promise<SourceFindings>;
    if (classified.kind === "website") {
      // The server scan fetches through safeFetch; the browser never fetches
      // the owner's address itself.
      promise = scanWebsite({ url: classified.url })
        .then((scan) => ({
          website: scan,
          websitePartial: scan.coverage.truncated || scan.coverage.failedPageCount > 0 || scan.coverage.sitemapFailureCount > 0,
          listing: null,
        }))
        .catch((error: unknown) => {
          toast.warning("We couldn’t read your website", {
            description: error instanceof Error ? error.message : "You can scan it again from Edit project.",
          });
          return { website: null, websitePartial: false, listing: null };
        });
    } else if (selectedBusiness) {
      // Only a listing the owner picked from the list is used.
      promise = lookupGmb({ name: selectedBusiness.title, placeId: selectedBusiness.placeId })
        .then((listing) => ({
          website: null,
          websitePartial: false,
          listing: {
            title: listing.title,
            address: listing.address,
            phone: listing.phone,
            website: listing.website,
            rating: listing.rating,
            reviews: listing.reviews,
            category: listing.category,
            openHours: listing.openHours,
          },
        }))
        .catch((error: unknown) => {
          toast.warning("We couldn’t load your Google listing", {
            description: error instanceof Error ? error.message : "Try again later.",
          });
          return { website: null, websitePartial: false, listing: null };
        });
    } else {
      promise = Promise.resolve({ website: null, websitePartial: false, listing: null });
    }
    findings.current = { key, promise };
    return promise;
  };

  const goNext = () => {
    if (step === 1) {
      if (!name.trim()) {
        setNameError(true);
        nameRef.current?.focus();
        return;
      }
      void readSources();
    }
    setStep(Math.min(step + 1, steps.length - 1));
  };

  const handleFinish = async () => {
    if (!name.trim()) {
      setNameError(true);
      setStep(1);
      return;
    }
    setCreating(true);
    try {
      const found = await readSources();
      const scan = found.website;
      const listing = found.listing;
      const id = await create({
        name: name.trim(),
        businessType,
        primaryGoal: primaryGoal ?? defaultGoalFor(businessType),
        businessName: scan?.businessDetails.name?.trim() || listing?.title?.trim() || undefined,
        websiteUrl: classified.kind === "website" ? classified.url : listing?.website || undefined,
        industry: listing?.category?.trim() || undefined,
        description: (scan?.metaDescription || scan?.titles?.[0] || "").trim() || undefined,
        googleBusinessName: listing && selectedBusiness ? selectedBusiness.title : undefined,
        productsServices: scan?.productsServices?.length ? scan.productsServices.slice(0, 20) : undefined,
      });

      // Keep the findings so every module can reuse the enriched context.
      if (scan || listing) {
        try {
          await saveScan({
            id,
            status: found.websitePartial ? "partial" : "scraped",
            sitemapUrls: scan?.sitemapUrls,
            titles: scan?.titles,
            metaDescription: scan?.metaDescription,
            headings: scan?.headings,
            productsServices: scan?.productsServices,
            pages: scan?.pages,
            socialChannels: scan?.socialChannels,
            businessDetails: scan?.businessDetails,
            coverage: scan?.coverage,
            gmb: listing ?? undefined,
          });
        } catch {
          toast.warning("Project created, but what we found wasn’t saved. You can scan it again from Edit project.");
        }
      }
      // Draft the business understanding on the server; the owner reviews it
      // on the project Home. It runs in the background and never blocks.
      void draftBusinessProfile({ projectId: id }).catch(() => undefined);
      // Start the starter kit (plan, website, posts). If it cannot start
      // (for example a role without edit, or a network error), the project
      // still exists, so Home opens anyway. Home has no "start the kit" entry
      // yet for a project without one (follow-up recorded in the U4 PR).
      let kitStarted = true;
      try {
        await startKit({ projectId: id });
      } catch {
        kitStarted = false;
      }
      toast.success("Project created", {
        description: kitStarted
          ? "Your starter kit is being drafted. Watch it fill in on the next screen."
          : "We could not start your starter kit yet. Your answers are saved.",
      });
      navigate(`/app/${id}`);
    } catch (error) {
      toast.error("Could not create project", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setCreating(false);
    }
  };

  const isLast = step === steps.length - 1;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6 grid gap-3">
        <p className="font-mono text-caption text-muted-foreground">
          Question {step + 1} of {steps.length}
        </p>
        <div
          role="progressbar"
          aria-label="New project progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={step + 1}
          aria-valuetext={`Question ${step + 1} of ${steps.length}: ${steps[step].label}`}
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
        <p className="sr-only" role="status" aria-live="polite">
          {`Question ${step + 1} of ${steps.length}: ${steps[step].label}`}
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
            {step === 0 && <BusinessTypeQuestion value={businessType} onChange={setBusinessType} />}
            {step === 1 && (
              <NameQuestion
                name={name}
                onNameChange={(value) => {
                  setName(value);
                  if (value.trim()) setNameError(false);
                }}
                nameError={nameError}
                nameRef={nameRef}
                source={source}
                onSourceChange={setSource}
                selectedBusiness={selectedBusiness}
                onSelectBusiness={setSelectedBusiness}
                onEnter={goNext}
              />
            )}
            {step === 2 && <GoalQuestion businessType={businessType} value={primaryGoal} onChange={setPrimaryGoal} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-3 shadow-soft surface-glass">
        <p className="sr-only" role="status" aria-live="polite">
          {creating ? "Making your starter kit. Reading what you shared can take a little while." : ""}
        </p>
        {step > 0 && (
          <Button variant="ghost" className="min-h-11" onClick={() => setStep(step - 1)} disabled={creating}>
            Back
          </Button>
        )}
        {isLast ? (
          <Button className="ml-auto min-h-11" onClick={() => void handleFinish()} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
            {creating ? "Making your starter kit…" : "Make my starter kit"}
          </Button>
        ) : (
          <Button className="ml-auto min-h-11" onClick={goNext}>
            Continue <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {step === 1 && name.trim() === "" && !nameError && (
        <p className="mt-3 flex items-center gap-2 font-mono text-caption text-muted-foreground">
          <Check className="size-3.5" aria-hidden="true" /> Only the name is needed. Everything else is optional.
        </p>
      )}
    </div>
  );
}
