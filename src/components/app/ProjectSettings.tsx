import { useId, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { ChipInput } from "@/components/app/ChipInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type Project = Doc<"projects">;
type StoredProfile = NonNullable<Project["businessProfile"]>;
type BusinessModel = StoredProfile["businessModel"];
type EditableProfile = Omit<StoredProfile, "status" | "updatedAt" | "confirmedAt">;

const BUSINESS_MODEL_LABELS: Record<BusinessModel, string> = {
  b2c: "Sells to consumers",
  b2b: "Sells to businesses",
  b2b2c: "Sells to businesses that serve consumers",
  nonprofit: "Non-profit",
  public_sector: "Public sector",
  mixed: "A mix",
};

const EMPTY_PROFILE: EditableProfile = {
  summary: "",
  businessModel: "mixed",
  offerings: [],
  customerSegments: [],
  notTheAudience: [],
  customerProblems: [],
  primaryGoals: [],
  market: undefined,
  differentiators: [],
  contentThemes: [],
};

function editable(profile: StoredProfile | undefined): EditableProfile {
  if (!profile) return EMPTY_PROFILE;
  return {
    summary: profile.summary,
    businessModel: profile.businessModel,
    offerings: profile.offerings,
    customerSegments: profile.customerSegments,
    notTheAudience: profile.notTheAudience,
    customerProblems: profile.customerProblems,
    primaryGoals: profile.primaryGoals,
    market: profile.market,
    differentiators: profile.differentiators,
    contentThemes: profile.contentThemes,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "Try again.";
}

/** One labelled field: the label is always tied to its control. */
function FieldRow({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {help ? (
        <p id={`${id}-help`} className="font-mono text-caption text-muted-foreground">
          {help}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/**
 * "Edit project": the owner can change everything onboarding asked, review
 * the AI's understanding of the business (the brief every AI feature uses),
 * and re-scan the website. Opens as a side sheet from Overview and the
 * project menu.
 */
export function ProjectSettingsSheet({
  projectId,
  open,
  onOpenChange,
  initialTab = "understanding",
}: {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: "understanding" | "details" | "customers";
}) {
  const project = useQuery(api.projects.get, open ? { id: projectId } : "skip");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-mono">Edit project</SheetTitle>
          <SheetDescription>
            Everything MOSAI creates — customer profiles, journeys, content and your website — starts from what you set here.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-8">
          {project === undefined ? (
            <div className="flex items-center gap-2 py-10 font-mono text-caption text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading project…
            </div>
          ) : project === null ? (
            <p className="py-10 font-mono text-caption text-muted-foreground" role="alert">
              This project isn’t available. It may have been deleted, or you no longer have access.
            </p>
          ) : (
            <Tabs key={`${open}-${initialTab}`} defaultValue={initialTab}>
              <TabsList className="w-full">
                <TabsTrigger value="understanding">Your business</TabsTrigger>
                <TabsTrigger value="customers">Customers</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
              </TabsList>
              <TabsContent value="understanding" className="mt-5">
                <UnderstandingForm project={project} />
              </TabsContent>
              <TabsContent value="customers" className="mt-5">
                <CustomersForm project={project} />
              </TabsContent>
              <TabsContent value="details" className="mt-5">
                <DetailsForm project={project} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Business understanding: review the AI draft, edit, confirm ──────────── */

export function BusinessUnderstandingStatus({ profile }: { profile: StoredProfile | undefined }) {
  if (!profile) {
    return (
      <Badge variant="outline" className="font-mono text-caption text-muted-foreground">
        Not created yet
      </Badge>
    );
  }
  return profile.status === "confirmed" ? (
    <Badge variant="outline" className="font-mono text-caption border-terminal-green/40 text-terminal-green">
      Confirmed by you
    </Badge>
  ) : (
    <Badge variant="outline" className="font-mono text-caption border-terminal-amber/40 text-terminal-amber">
      Draft — please review
    </Badge>
  );
}

function UnderstandingForm({ project }: { project: Project }) {
  const uid = useId();
  const saveProfile = useMutation(api.projects.saveBusinessProfile);
  const draft = useAction(api.ai.generateBusinessProfile);
  const [form, setForm] = useState<EditableProfile>(() => editable(project.businessProfile));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "confirm" | "draft" | null>(null);

  // Follow server updates (e.g. the background draft finishing) until the
  // owner starts editing — adjusted during render, not in an effect.
  const serverVersion = project.businessProfile?.updatedAt ?? 0;
  const [seenVersion, setSeenVersion] = useState(serverVersion);
  if (serverVersion !== seenVersion && !dirty) {
    setSeenVersion(serverVersion);
    setForm(editable(project.businessProfile));
  }

  const set = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const submit = async (confirm: boolean) => {
    setBusy(confirm ? "confirm" : "save");
    try {
      await saveProfile({ id: project._id, profile: form, confirm });
      setDirty(false);
      toast.success(confirm ? "Confirmed — MOSAI will use this everywhere" : "Saved");
    } catch (error) {
      toast.error("Couldn’t save", { description: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const redraft = async () => {
    const confirmed = project.businessProfile?.status === "confirmed";
    if (
      confirmed &&
      !window.confirm("Replace your confirmed summary with a new AI draft? You can review it before confirming again.")
    ) {
      return;
    }
    setBusy("draft");
    try {
      await draft({ projectId: project._id, replaceConfirmed: confirmed });
      setDirty(false);
      toast.success("New draft ready — review it below");
    } catch (error) {
      toast.error("Couldn’t draft the summary", { description: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const hasProfile = Boolean(project.businessProfile);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border bg-card p-3">
        <div className="grid gap-1">
          <p className="font-mono text-small font-medium">How MOSAI understands your business</p>
          <p className="font-mono text-caption text-muted-foreground">
            Check that the customers are the people who pay you. Personas, content and your website are all written for them.
          </p>
        </div>
        <BusinessUnderstandingStatus profile={project.businessProfile} />
      </div>

      {!hasProfile && busy !== "draft" ? (
        <div className="grid gap-3 rounded-md border border-dashed p-4">
          <p className="font-mono text-caption text-muted-foreground">
            MOSAI hasn’t drafted a summary yet. It reads your details, website and Google listing — takes about 15 seconds.
          </p>
          <Button onClick={redraft} className="w-fit">
            <Sparkles className="size-4" aria-hidden="true" /> Draft it for me
          </Button>
        </div>
      ) : null}

      {busy === "draft" ? (
        <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Reading your business…
        </p>
      ) : null}

      {hasProfile ? (
        <>
          <FieldRow id={`${uid}-summary`} label="In one or two sentences, what does the business do, for whom?">
            <Textarea
              id={`${uid}-summary`}
              value={form.summary}
              onChange={(e) => set("summary", e.target.value)}
              rows={3}
              maxLength={600}
            />
          </FieldRow>
          <FieldRow id={`${uid}-model`} label="Who do you sell to?">
            <Select value={form.businessModel} onValueChange={(value) => set("businessModel", value as BusinessModel)}>
              <SelectTrigger id={`${uid}-model`} className="w-full sm:w-80">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(BUSINESS_MODEL_LABELS) as BusinessModel[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {BUSINESS_MODEL_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow id={`${uid}-offerings`} label="What customers pay you for">
            <ChipInput id={`${uid}-offerings`} values={form.offerings} onChange={(v) => set("offerings", v)} maxItems={8} />
          </FieldRow>
          <FieldRow
            id={`${uid}-segments`}
            label="Your customers"
            help="The people or organisations who buy. Personas are created from these groups."
          >
            <ChipInput
              id={`${uid}-segments`}
              ariaDescribedBy={`${uid}-segments-help`}
              values={form.customerSegments}
              onChange={(v) => set("customerSegments", v)}
              maxItems={8}
            />
          </FieldRow>
          <FieldRow
            id={`${uid}-not`}
            label="Not your customers"
            help="People who appear on your website but don’t buy — for example your team or job applicants. MOSAI never writes for them."
          >
            <ChipInput
              id={`${uid}-not`}
              ariaDescribedBy={`${uid}-not-help`}
              values={form.notTheAudience}
              onChange={(v) => set("notTheAudience", v)}
              maxItems={8}
            />
          </FieldRow>
          <FieldRow id={`${uid}-problems`} label="Problems customers come to you with">
            <ChipInput id={`${uid}-problems`} values={form.customerProblems} onChange={(v) => set("customerProblems", v)} maxItems={8} />
          </FieldRow>
          <FieldRow id={`${uid}-goals`} label="Business goals">
            <ChipInput id={`${uid}-goals`} values={form.primaryGoals} onChange={(v) => set("primaryGoals", v)} maxItems={8} />
          </FieldRow>
          <FieldRow id={`${uid}-market`} label="Where you sell">
            <Input
              id={`${uid}-market`}
              value={form.market ?? ""}
              onChange={(e) => set("market", e.target.value || undefined)}
              maxLength={120}
            />
          </FieldRow>
          <FieldRow id={`${uid}-diff`} label="Why customers choose you">
            <ChipInput id={`${uid}-diff`} values={form.differentiators} onChange={(v) => set("differentiators", v)} maxItems={6} />
          </FieldRow>
          <FieldRow
            id={`${uid}-themes`}
            label="Topics your customers care about"
            help="Subjects from your own field. Content ideas start here."
          >
            <ChipInput
              id={`${uid}-themes`}
              ariaDescribedBy={`${uid}-themes-help`}
              values={form.contentThemes}
              onChange={(v) => set("contentThemes", v)}
              maxItems={8}
            />
          </FieldRow>

          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button onClick={() => submit(true)} disabled={busy !== null}>
              {busy === "confirm" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save and confirm
            </Button>
            <Button variant="outline" onClick={() => submit(false)} disabled={busy !== null || !dirty}>
              {busy === "save" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save draft
            </Button>
            <Button variant="ghost" onClick={redraft} disabled={busy !== null}>
              <RefreshCw className="size-4" aria-hidden="true" /> Ask AI to redo it
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ── Customers: the owner's own words about who buys ─────────────────────── */

function CustomersForm({ project }: { project: Project }) {
  const uid = useId();
  const update = useMutation(api.projects.update);
  const [audience, setAudience] = useState(project.targetAudience ?? []);
  const [pains, setPains] = useState(project.customerPains ?? []);
  const [goals, setGoals] = useState(project.goals ?? []);
  const [serviceArea, setServiceArea] = useState(project.serviceArea ?? "");
  const [challenges, setChallenges] = useState(project.marketingChallenges ?? []);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await update({
        id: project._id,
        targetAudience: audience,
        customerPains: pains,
        goals,
        serviceArea,
        marketingChallenges: challenges,
      });
      toast.success("Saved");
    } catch (error) {
      toast.error("Couldn’t save", { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5">
      <FieldRow
        id={`${uid}-audience`}
        label="Who pays you? Your customers"
        help="Be specific, e.g. “homeowners planning an extension” — not your team."
      >
        <ChipInput id={`${uid}-audience`} ariaDescribedBy={`${uid}-audience-help`} values={audience} onChange={setAudience} maxItems={12} />
      </FieldRow>
      <FieldRow id={`${uid}-pains`} label="What problems do customers come to you with?">
        <ChipInput id={`${uid}-pains`} values={pains} onChange={setPains} maxItems={12} />
      </FieldRow>
      <FieldRow id={`${uid}-area`} label="Where are your customers?">
        <Input id={`${uid}-area`} value={serviceArea} onChange={(e) => setServiceArea(e.target.value)} maxLength={200} />
      </FieldRow>
      <FieldRow id={`${uid}-goals`} label="Your business goals">
        <ChipInput id={`${uid}-goals`} values={goals} onChange={setGoals} />
      </FieldRow>
      <FieldRow
        id={`${uid}-challenges`}
        label="What’s holding your marketing back?"
        help="Used to plan your next steps in MOSAI. It is never treated as your customers’ problems."
      >
        <ChipInput id={`${uid}-challenges`} ariaDescribedBy={`${uid}-challenges-help`} values={challenges} onChange={setChallenges} maxItems={12} />
      </FieldRow>
      <div className="border-t pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Save customers
        </Button>
      </div>
    </div>
  );
}

/* ── AI model: one of the operator-enabled models ────────────────────────── */

const DEFAULT_CHOICE = "__platform_default__";

function AiModelPicker({ project }: { project: Project }) {
  const uid = useId();
  const models = useQuery(api.aiModels.listAvailable, {});
  const setModel = useMutation(api.projects.setAiModel);
  const [saving, setSaving] = useState(false);
  const current = project.aiModelId ?? DEFAULT_CHOICE;
  const defaultModel = models?.find((model) => model.isDefault);
  const unavailable = project.aiModelId && models && !models.some((m) => m.modelId === project.aiModelId);

  const choose = async (value: string) => {
    setSaving(true);
    try {
      await setModel({ id: project._id, modelId: value === DEFAULT_CHOICE ? null : value });
      toast.success("AI model updated");
    } catch (error) {
      toast.error("Couldn’t change the model", { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-2 rounded-md border bg-card p-3">
      <Label htmlFor={`${uid}-model`} className="font-mono text-small font-medium">AI model for this project</Label>
      <p id={`${uid}-model-help`} className="font-mono text-caption text-muted-foreground">
        Used for customer profiles, journeys, content and your website. Your administrator decides which models are offered.
      </p>
      {models === undefined ? (
        <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading models…
        </p>
      ) : (
        <Select value={current} onValueChange={choose} disabled={saving}>
          <SelectTrigger id={`${uid}-model`} aria-describedby={`${uid}-model-help`} className="w-full sm:w-96">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_CHOICE}>
              Recommended{defaultModel ? ` — ${defaultModel.label}` : ""}
            </SelectItem>
            {models.map((model) => (
              <SelectItem key={model.modelId} value={model.modelId}>
                {model.label}
                {model.description ? ` — ${model.description}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {unavailable ? (
        <p className="font-mono text-caption text-terminal-amber" role="status">
          The model chosen earlier is no longer offered, so the recommended one is used.
        </p>
      ) : null}
    </div>
  );
}

/* ── Details: name, website, industry, offer, competitors, re-scan ───────── */

function DetailsForm({ project }: { project: Project }) {
  const uid = useId();
  const update = useMutation(api.projects.update);
  const rescan = useAction(api.scraping.rescanProjectWebsite);
  const [name, setName] = useState(project.name);
  const [businessName, setBusinessName] = useState(project.businessName ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(project.websiteUrl ?? "");
  const [industry, setIndustry] = useState(project.industry ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [offer, setOffer] = useState(project.productsServices ?? []);
  const [competitors, setCompetitors] = useState(project.competitors ?? []);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give the project a name.");
      return;
    }
    setSaving(true);
    try {
      await update({
        id: project._id,
        name,
        businessName,
        websiteUrl,
        industry,
        description,
        productsServices: offer,
        competitors,
        competitorEntries: competitors.map((value) => ({
          type: /^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(value) ? ("website" as const) : ("gmb" as const),
          value,
        })),
      });
      toast.success("Saved");
    } catch (error) {
      toast.error("Couldn’t save", { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  const scanAgain = async () => {
    setScanning(true);
    try {
      const result = await rescan({ projectId: project._id });
      toast.success("Website scanned", {
        description: `${result.scannedPageCount} page${result.scannedPageCount === 1 ? "" : "s"} read${result.status === "partial" ? " (some pages couldn’t be read)" : ""}.`,
      });
    } catch (error) {
      toast.error("Couldn’t scan the website", { description: errorText(error) });
    } finally {
      setScanning(false);
    }
  };

  const scannedAt = project.websiteScan?.scannedAt;

  return (
    <div className="grid gap-5">
      <FieldRow id={`${uid}-name`} label="Project name">
        <Input id={`${uid}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      </FieldRow>
      <FieldRow id={`${uid}-biz`} label="Business name (as customers know it)">
        <Input id={`${uid}-biz`} value={businessName} onChange={(e) => setBusinessName(e.target.value)} maxLength={160} />
      </FieldRow>
      <FieldRow id={`${uid}-industry`} label="Industry">
        <Input id={`${uid}-industry`} value={industry} onChange={(e) => setIndustry(e.target.value)} maxLength={120} />
      </FieldRow>
      <FieldRow id={`${uid}-desc`} label="Description">
        <Textarea id={`${uid}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} />
      </FieldRow>
      <FieldRow id={`${uid}-offer`} label="What customers pay you for">
        <ChipInput id={`${uid}-offer`} values={offer} onChange={setOffer} maxItems={40} />
      </FieldRow>
      <FieldRow id={`${uid}-competitors`} label="Competitors to keep an eye on" help="A website or a business name and city.">
        <ChipInput id={`${uid}-competitors`} ariaDescribedBy={`${uid}-competitors-help`} values={competitors} onChange={setCompetitors} />
      </FieldRow>
      <FieldRow id={`${uid}-web`} label="Website">
        <Input
          id={`${uid}-web`}
          type="url"
          inputMode="url"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="https://"
          maxLength={500}
        />
      </FieldRow>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Save details
        </Button>
      </div>

      <AiModelPicker project={project} />

      <div className="grid gap-2 rounded-md border bg-card p-3">
        <p className="font-mono text-small font-medium">Website scan</p>
        <p className="font-mono text-caption text-muted-foreground">
          {scannedAt
            ? `Last read ${new Date(scannedAt).toLocaleDateString()} · ${project.websiteScan?.coverage?.scannedPageCount ?? project.websiteScan?.pages?.length ?? 0} pages.`
            : "Your website hasn’t been read yet."}{" "}
          Save a changed address first, then scan again.
        </p>
        <Button variant="outline" className="w-fit" onClick={scanAgain} disabled={scanning || !project.websiteUrl}>
          {scanning ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-4" aria-hidden="true" />}
          {scanning ? "Reading your website…" : "Scan website again"}
        </Button>
      </div>
    </div>
  );
}
