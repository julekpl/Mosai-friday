import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ScanResult } from "@/convex/scraping";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { displayDomain } from "@/lib/url";
import { MOSAI_EASE, MOTION } from "@/components/motion";
import type { BusinessType, CustomerGroup, PostingChannel, PrimaryGoal } from "@/shared/starterKit";
import { classifySource } from "@/components/app/wizard/classifySource";
import type { BusinessListing, BusinessSuggestion, SourceFindingsStatus } from "@/components/app/wizard/types";
import {
  EMPTY_NOTES,
  answeredType,
  isAgency,
  toAnswers,
  type AnswerDrafts,
  type ClientBusinessType,
  type NoteDrafts,
} from "@/components/app/wizard/selection";
import { foundDetails } from "@/components/app/wizard/findings";
import { BusinessTypeQuestion } from "@/components/app/wizard/BusinessTypeQuestion";
import { NameQuestion } from "@/components/app/wizard/NameQuestion";
import { GoalQuestion } from "@/components/app/wizard/GoalQuestion";
import { ChannelsQuestion } from "@/components/app/wizard/ChannelsQuestion";
import { CustomersQuestion } from "@/components/app/wizard/CustomersQuestion";
import { SummaryStep } from "@/components/app/wizard/SummaryStep";
import { isLookupResting } from "@/lib/lookupErrors";

/** First run: six short screens (first-run blueprint §2–§3, U2d). Screens 1
 *  and 2 must be answered; 3 to 5 can be skipped; 6 is the check-over. */
const steps = [
  { key: "type", label: "Kind of business" },
  { key: "name", label: "Name" },
  { key: "goals", label: "What you want more of" },
  { key: "channels", label: "Where you are active" },
  { key: "customers", label: "Your customers" },
  { key: "summary", label: "Here’s what we found" },
] as const;
const SKIPPABLE = new Set([2, 3, 4]);

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
  failed: boolean;
  /** LQ-1: the paid business search is paused (platform or daily limit),
   *  which is not a failure of the owner's listing. */
  resting?: boolean;
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

  const [types, setTypes] = useState<BusinessType[]>([]);
  const [typeError, setTypeError] = useState(false);
  // U9: "I set this up for a client" sets up one client; the rest of the
  // answers describe that client.
  const [clientType, setClientType] = useState<ClientBusinessType | undefined>();
  const forClient = isAgency(types);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState("");
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessSuggestion | null>(null);
  const [goals, setGoals] = useState<PrimaryGoal[]>([]);
  const [channels, setChannels] = useState<PostingChannel[]>([]);
  const [customers, setCustomers] = useState<CustomerGroup[]>([]);
  const [notes, setNotes] = useState<NoteDrafts>(EMPTY_NOTES);
  const setNote = (key: keyof NoteDrafts) => (value: string) => setNotes((current) => ({ ...current, [key]: value }));
  const [creating, setCreating] = useState(false);

  const drafts: AnswerDrafts = { types, clientType, goals, channels, customers, notes };

  // The source is read in the background once the owner leaves Q2, so the
  // result is usually ready by the last screen. Keyed so going back and
  // changing the answer starts a fresh read, and an unchanged answer is
  // never read (or paid for) twice.
  const findings = useRef<{ key: string; promise: Promise<SourceFindings> } | null>(null);
  // The same read, as state, for the "Here's what we found" screen.
  const [findingsState, setFindingsState] = useState<{ key: string; view: SourceFindingsStatus } | null>(null);

  const create = useMutation(api.projects.create);
  const createClientProject = useMutation(api.projects.createClientProject);
  const saveScan = useMutation(api.projects.saveScan);
  const startKit = useMutation(api.starterKit.start);
  const draftBusinessProfile = useAction(api.ai.generateBusinessProfile);
  const scanWebsite = useAction(api.scraping.scanWebsite);
  const lookupGmb = useAction(api.scraping.lookupGoogleBusiness);
  const navigate = useNavigate();

  const classified = classifySource(source);
  const sourceKey = classified.kind === "website"
    ? `web:${classified.url}`
    : selectedBusiness ? `place:${selectedBusiness.placeId}` : "none";

  const readSources = (): Promise<SourceFindings> => {
    const key = sourceKey;
    if (findings.current?.key === key) return findings.current.promise;
    const empty: SourceFindings = { website: null, websitePartial: false, listing: null, failed: false };
    let promise: Promise<SourceFindings>;
    let kind: "website" | "listing" | null = null;
    if (classified.kind === "website") {
      kind = "website";
      // The server scan fetches through safeFetch; the browser never fetches
      // the owner's address itself.
      promise = scanWebsite({ url: classified.url })
        .then((scan) => ({
          website: scan,
          websitePartial: scan.coverage.truncated || scan.coverage.failedPageCount > 0 || scan.coverage.sitemapFailureCount > 0,
          listing: null,
          failed: false,
        }))
        .catch((error: unknown) => {
          toast.warning("We couldn’t read your website", {
            description: error instanceof Error ? error.message : "You can scan it again from Edit project.",
          });
          return { ...empty, failed: true };
        });
    } else if (selectedBusiness) {
      kind = "listing";
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
          failed: false,
        }))
        .catch((error: unknown) => {
          if (isLookupResting(error)) {
            return { ...empty, failed: true, resting: true };
          }
          toast.warning("We couldn’t load your Google listing", {
            description: error instanceof Error ? error.message : "Try again later.",
          });
          return { ...empty, failed: true };
        });
    } else {
      promise = Promise.resolve(empty);
    }
    findings.current = { key, promise };
    if (kind) {
      const readKind = kind;
      setFindingsState({ key, view: { status: "running", kind: readKind } });
      void promise.then((found) => {
        setFindingsState((current) =>
          current?.key === key
            ? {
                key,
                view: {
                  status: "done",
                  kind: readKind,
                  failed: found.failed,
                  resting: found.resting === true,
                  partial: found.websitePartial,
                  details: foundDetails(found.website, found.listing),
                },
              }
            : current,
        );
      });
    } else {
      setFindingsState({ key, view: { status: "none" } });
    }
    return promise;
  };

  const findingsView: SourceFindingsStatus =
    findingsState && findingsState.key === sourceKey ? findingsState.view : { status: "none" };
  const sourceText = classified.kind === "website"
    ? displayDomain(classified.url)
    : selectedBusiness
      ? `Google listing for ${selectedBusiness.title}`
      : undefined;

  const typeAnswered = types.length > 0 || notes.businessType.trim() !== "";
  const stepAnswered =
    (step === 2 && (goals.length > 0 || notes.goal.trim() !== "")) ||
    (step === 3 && (channels.length > 0 || notes.channel.trim() !== "")) ||
    (step === 4 && (customers.length > 0 || notes.customers.trim() !== "" || notes.anythingElse.trim() !== ""));

  const goNext = () => {
    if (step === 0 && !typeAnswered) {
      setTypeError(true);
      stepRegionRef.current?.querySelector<HTMLInputElement>("input[type=checkbox]")?.focus();
      return;
    }
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

  /**
   * After "Make my starter kit": the project exists and the kit was asked to
   * start. One place for what happens next, so the bootloader (PR C) can hook
   * in here without touching the create flow.
   */
  const openNewProject = (projectId: Id<"projects">, kitStarted: boolean) => {
    toast.success("Project created", {
      description: kitStarted
        ? "Your starter kit is being drafted. Watch it fill in on the next screen."
        : "We could not start your starter kit yet. Your answers are saved.",
    });
    navigate(`/app/${projectId}`);
  };

  const handleFinish = async () => {
    if (!typeAnswered && !forClient) {
      setTypeError(true);
      setStep(0);
      return;
    }
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
      const fields = {
        businessName: scan?.businessDetails.name?.trim() || listing?.title?.trim() || undefined,
        websiteUrl: classified.kind === "website" ? classified.url : listing?.website || undefined,
        industry: listing?.category?.trim() || undefined,
        description: (scan?.metaDescription || scan?.titles?.[0] || "").trim() || undefined,
        googleBusinessName: listing && selectedBusiness ? selectedBusiness.title : undefined,
        productsServices: scan?.productsServices?.length ? scan.productsServices.slice(0, 20) : undefined,
      };
      const answers = toAnswers(drafts, { defaultGoal: true });
      // An agency sets up a client: the server creates the client and links
      // it to the agency in the same step (U9).
      const id = forClient
        ? await createClientProject({
            clientName: name.trim(),
            ...answers,
            businessType: clientType,
            ...fields,
          })
        : await create({
            name: name.trim(),
            ...answers,
            ...fields,
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
      // still exists, so Home opens anyway.
      let kitStarted = true;
      try {
        await startKit({ projectId: id });
      } catch {
        kitStarted = false;
      }
      openNewProject(id, kitStarted);
    } catch (error) {
      toast.error("Could not create project", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
      setCreating(false);
    }
  };

  const isLast = step === steps.length - 1;
  const stepText = `Step ${step + 1} of ${steps.length}: ${steps[step].label}`;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6 grid gap-3">
        <p className="font-mono text-caption text-muted-foreground">
          Step {step + 1} of {steps.length}
        </p>
        <div
          role="progressbar"
          aria-label="New project progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={step + 1}
          aria-valuetext={stepText}
          className="grid grid-cols-6 gap-1.5"
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
          {stepText}
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
            {step === 0 && (
              <BusinessTypeQuestion
                value={types}
                onChange={(next) => {
                  setTypes(next);
                  if (next.length) setTypeError(false);
                }}
                otherNote={notes.businessType}
                onOtherNoteChange={(value) => {
                  setNote("businessType")(value);
                  if (value.trim()) setTypeError(false);
                }}
                clientType={clientType}
                onClientTypeChange={setClientType}
                error={typeError}
              />
            )}
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
                forClient={forClient}
              />
            )}
            {step === 2 && (
              <GoalQuestion
                businessType={answeredType(drafts)}
                value={goals}
                onChange={setGoals}
                otherNote={notes.goal}
                onOtherNoteChange={setNote("goal")}
              />
            )}
            {step === 3 && (
              <ChannelsQuestion
                value={channels}
                onChange={setChannels}
                otherNote={notes.channel}
                onOtherNoteChange={setNote("channel")}
              />
            )}
            {step === 4 && (
              <CustomersQuestion
                value={customers}
                onChange={setCustomers}
                otherNote={notes.customers}
                onOtherNoteChange={setNote("customers")}
                anythingElse={notes.anythingElse}
                onAnythingElseChange={setNote("anythingElse")}
              />
            )}
            {step === 5 && (
              <SummaryStep
                name={name}
                sourceText={sourceText}
                findings={findingsView}
                answers={drafts}
                onFix={setStep}
              />
            )}
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
        ) : SKIPPABLE.has(step) && !stepAnswered ? (
          <Button variant="outline" className="ml-auto min-h-11" onClick={goNext}>
            Skip for now <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        ) : (
          <Button className="ml-auto min-h-11" onClick={goNext}>
            Continue <ArrowRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
      {step === 1 && name.trim() === "" && !nameError && (
        <p className="mt-3 flex items-center gap-2 font-mono text-caption text-muted-foreground">
          <Check className="size-3.5" aria-hidden="true" /> Only the name is needed here. The website or listing is optional.
        </p>
      )}
    </div>
  );
}
