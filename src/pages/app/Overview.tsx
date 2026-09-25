import { Fragment, useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  FileDown,
  FolderX,
  Globe,
  Loader2,
  MapPin,
  MessageSquareText,
  PenTool,
  Pencil,
  Plug,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import { MOSAI_EASE, MOTION } from "@/components/motion";
import {
  DATA_PROVIDERS,
  ModuleEmpty,
  ModuleErrorBoundary,
  ModuleSkeleton,
  StatusBadge,
} from "@/components/app/module-kit";
import { BrandStatus } from "@/components/app/BrandKitForm";
import { ProjectFilesSection } from "@/components/app/ProjectFiles";
import {
  BusinessUnderstandingStatus,
  ProjectSettingsSheet,
  type ProjectSettingsTab,
} from "@/components/app/ProjectSettings";
import { ModuleGrid, type ModuleCardId } from "@/components/app/ModuleGrid";
import { SinceYouWereAway } from "@/components/app/SinceYouWereAway";
import { ThisWeekNextStep } from "@/components/app/ThisWeekNextStep";
import { StarterKitCards } from "@/components/app/kit/StarterKitCards";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useModuleEntitlements } from "@/hooks/use-module-entitlements";
import { displayDomain } from "@/lib/url";
import { cn } from "@/lib/utils";


/* ── Motion: staggered, reduced-motion aware via the app MotionConfig ──── */

const staggerParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

const riseIn: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: MOTION.slow, ease: MOSAI_EASE } },
};

/** Page section that rises in as part of the page's stagger. */
function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={riseIn} className={className}>
      {children}
    </motion.div>
  );
}

function SectionHeading({
  id,
  title,
  hint,
  action,
}: {
  id: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h2 id={id} className="font-mono text-h3">
          {title}
        </h2>
        {hint && <p className="mt-0.5 font-mono text-caption text-muted-foreground">{hint}</p>}
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/* ── Welcome header ─────────────────────────────────────────────────────── */

type ProjectDoc = Doc<"projects">;

function HeaderStat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card/80 px-4 py-3">
      <dt className="font-mono text-caption text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-metric">
        {value === undefined ? (
          <span aria-hidden="true" className="block h-7 w-10 animate-pulse rounded-sm bg-muted" />
        ) : (
          value
        )}
        {value === undefined && <span className="sr-only">Loading</span>}
      </dd>
    </div>
  );
}

function WelcomeHeader({
  project,
  stats,
  onDownloadPack,
  packReady,
  onEdit,
}: {
  project: ProjectDoc | undefined;
  stats: { personas?: number; content?: number; files?: number; connected?: number };
  onDownloadPack: () => void;
  packReady: boolean;
  onEdit: () => void;
}) {
  const { user } = useAuth();
  const firstName = user?.name?.trim().split(/\s+/)[0];
  const greeting = greetingFor(new Date());
  const website = project?.websiteUrl ? displayDomain(project.websiteUrl) : null;

  return (
    <header className="relative overflow-hidden rounded-xl border bg-hero-wash p-5 shadow-soft sm:p-8">
      {/* Decorative mosaic cluster — the brand, quietly. */}
      <div aria-hidden="true" className="pointer-events-none absolute right-6 top-6 hidden grid-cols-3 gap-1.5 opacity-80 sm:grid">
        <span className="size-4 rounded-sm bg-tile-teal" />
        <span className="size-4 rounded-sm bg-tile-coral" />
        <span className="size-4" />
        <span className="size-4" />
        <span className="size-4 rounded-sm bg-tile-violet" />
        <span className="size-4 rounded-sm bg-tile-lime" />
      </div>

      <p className="font-mono text-small text-muted-foreground">
        {greeting}
        {firstName ? `, ${firstName}` : ""}. Here’s your workspace.
      </p>
      {project === undefined ? (
        <div role="status" className="mt-2 grid gap-2">
          <span className="sr-only">Loading project…</span>
          <span aria-hidden="true" className="h-9 w-64 max-w-full animate-pulse rounded-md bg-muted" />
          <span aria-hidden="true" className="h-4 w-96 max-w-full animate-pulse rounded-sm bg-muted" />
        </div>
      ) : (
        <>
          <h1 className="mt-1 max-w-3xl break-words font-mono text-h1 sm:text-display">{project?.name ?? "Project"}</h1>
          <p className="mt-3 max-w-2xl break-words font-mono text-small text-muted-foreground">
            {project?.description ??
              "One shared picture of your business — audiences, content and connections — that every module builds on."}
          </p>
        </>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {project?.industry && (
          <Badge variant="outline" className="max-w-full bg-card font-mono text-caption">
            <span className="truncate">{project.industry}</span>
          </Badge>
        )}
        {project?.websiteUrl && website && (
          <a
            href={project.websiteUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 font-mono text-caption text-terminal-green-ink underline-offset-4 hover:underline"
          >
            <Globe aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{website}</span>
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
        {project?.googleBusinessName && (
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 font-mono text-caption">
            <MapPin aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{project.googleBusinessName}</span>
          </span>
        )}
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={onEdit}>
            <Pencil className="size-4" aria-hidden="true" /> Edit project
          </Button>
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={onDownloadPack} disabled={!packReady}>
            <FileDown className="size-4" /> Download project pack
          </Button>
        </div>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeaderStat label="Audience profiles" value={stats.personas} />
        <HeaderStat label="Content pieces" value={stats.content} />
        <HeaderStat label="Attached files" value={stats.files} />
        <HeaderStat label="Verified connections" value={stats.connected} />
      </dl>
    </header>
  );
}

/* ── Communications section ─────────────────────────────────────────────── */

const COMMS_INFLUENCE_OPTIONS = [
  "content creation",
  "website / build",
  "campaigns",
  "data & insights",
] as const;

function CommsDialog({
  projectId,
  onOpenChange,
}: {
  projectId: Id<"projects">;
  onOpenChange: (o: boolean) => void;
}) {
  const generate = useAction(api.ai.generateComms);
  const create = useMutation(api.communications.create);

  const [topic, setTopic] = useState("");
  const [influence, setInfluence] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const toggleInfluence = (v: string) =>
    setInfluence((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );

  const run = async () => {
    if (!topic.trim()) return;
    setBusy(true);
    try {
      const result = await generate({
        projectId,
        topic: topic.trim(),
        influence: influence.length ? influence : undefined,
      });
      await create({ projectId, ...result, message: result.message || topic });
      toast.success(`Communication "${result.name}" drafted`);
      setTopic("");
      setInfluence([]);
      onOpenChange(false);
    } catch (e) {
      toast.error("Generation failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className="font-mono text-h3">
          Define a marketing communication
        </DialogTitle>
        <DialogDescription className="font-mono text-caption">
          AI drafts a one-page brief: the core message, the proof behind it,
          what customers should think, feel and do, and the channels. Switch
          it to “Used by AI” and every writer in MOSAI will use it.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="comms-topic">Topic / direction</Label>
          <Input
            id="comms-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. why we roast to order"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) void run();
            }}
          />
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">Should influence (optional)</legend>
          <div className="flex flex-wrap gap-1.5">
            {COMMS_INFLUENCE_OPTIONS.map((opt) => {
              const active = influence.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleInfluence(opt)}
                  className={`font-mono text-caption ${cn(
                    "rounded-full border px-2.5 py-1 transition-colors ease-terminal",
                    active
                      ? "border-terminal-green/40 bg-terminal-green-soft text-terminal-green-ink"
                      : "text-muted-foreground hover:text-foreground",
                  )}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !topic.trim()}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Drafting…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Draft with AI
              </>
            )}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

function CommunicationsSection({ projectId }: { projectId: Id<"projects"> }) {
  const comms = useQuery(api.communications.list, { projectId });
  const update = useMutation(api.communications.update);
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="comms-title">
      <SectionHeading
        id="comms-title"
        title="Marketing communications"
        hint="Messages switched to “Used by AI” shape every post, page and email MOSAI writes."
        action={
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" /> New with AI
          </Button>
        }
      />
      {comms === undefined ? (
        <ModuleSkeleton label="Loading communications…" rows={1} />
      ) : comms.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card/50 p-6 text-center">
          <MessageSquareText aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 font-mono text-small font-medium">No communications yet</p>
          <p className="mx-auto mt-1 max-w-md font-mono text-caption text-muted-foreground">
            AI can draft your core messages from project details, personas and files.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {comms.map((c) => (
            <article key={c._id} className="min-w-0 break-words rounded-lg border bg-card p-4 shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 font-mono text-small font-medium">{c.name}</h3>
                <div className="flex shrink-0 items-center gap-1">
                  <StatusBadge status={c.status === "active" ? "used_by_ai" : c.status} />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={c.status === "archived" ? `Restore ${c.name}` : `Archive ${c.name}`}
                    onClick={() =>
                      void update({
                        id: c._id,
                        status: c.status === "archived" ? "draft" : "archived",
                      })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 border-l-2 border-terminal-green/40 pl-2 font-mono text-caption">
                {c.message}
              </p>
              {c.pillar ? (
                <p className="mt-2 font-mono text-caption text-muted-foreground">supports: {c.pillar}</p>
              ) : null}
              {c.proofPoints?.length ? (
                <ul className="mt-2 grid gap-0.5 font-mono text-caption">
                  {c.proofPoints.map((point) => (
                    <li key={point}>✓ {point}</li>
                  ))}
                </ul>
              ) : null}
              {c.desiredResponse && (c.desiredResponse.think || c.desiredResponse.feel || c.desiredResponse.do) ? (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 font-mono text-caption">
                  {(["think", "feel", "do"] as const).map((key) =>
                    c.desiredResponse?.[key] ? (
                      <Fragment key={key}>
                        <dt className="text-muted-foreground">{key}</dt>
                        <dd>{c.desiredResponse[key]}</dd>
                      </Fragment>
                    ) : null,
                  )}
                </dl>
              ) : null}
              {c.callToAction ? (
                <p className="mt-2 font-mono text-caption">call to action: {c.callToAction}</p>
              ) : null}
              {c.audience && (
                <p className="mt-2 font-mono text-caption text-muted-foreground">
                  audience: {c.audience}
                </p>
              )}
              {c.channels?.length ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.channels.map((ch) => (
                    <Badge key={ch} variant="outline" className="font-mono text-caption">
                      {ch}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {c.rationale && (
                <p className="mt-2 font-mono text-caption text-muted-foreground">
                  {c.rationale}
                </p>
              )}
              {c.status !== "archived" ? (
                <div className="mt-3 flex items-center gap-2 border-t pt-3">
                  <Switch
                    id={`comms-active-${c._id}`}
                    checked={c.status === "active"}
                    onCheckedChange={(checked) =>
                      void update({ id: c._id, status: checked ? "active" : "draft" }).then(
                        () => toast.success(checked ? `AI writers will now use “${c.name}”` : `“${c.name}” is a draft again`),
                        () => toast.error("Couldn’t update the message"),
                      )
                    }
                  />
                  <Label htmlFor={`comms-active-${c._id}`} className="font-mono text-caption">
                    Used by AI in content, posts and pages
                  </Label>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <CommsDialog projectId={projectId} onOpenChange={setOpen} />
      </Dialog>
    </section>
  );
}

/* ── Details + connections ──────────────────────────────────────────────── */

function AboutSection({
  project,
  personaCount,
  projectId,
  onEdit,
}: {
  project: ProjectDoc | undefined;
  personaCount: number | undefined;
  projectId: Id<"projects">;
  onEdit: () => void;
}) {
  const generate = useAction(api.ai.generatePersona);
  const createPersona = useMutation(api.personas.create);
  const [generating, setGenerating] = useState(false);

  const quickGeneratePersona = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const p = await generate({ projectId });
      await createPersona({ projectId, ...p });
      toast.success(`Persona "${p.name}" generated`);
    } catch (e) {
      toast.error("Generation failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setGenerating(false);
    }
  };

  const hasDetails = Boolean(
    project?.productsServices?.length ||
      project?.goals?.length ||
      project?.competitors?.length ||
      project?.websiteScan?.gmb?.title,
  );

  return (
    <section aria-labelledby="about-title" className="flex h-full flex-col rounded-lg border bg-card p-5 shadow-soft">
      <SectionHeading id="about-title" title="About this business" hint="The shared context every module reads." />
      {project === undefined ? (
        <ModuleSkeleton label="Loading project details…" rows={1} />
      ) : (
        <div className="grid gap-3 font-mono text-caption">
          {project?.productsServices?.length ? (
            <div>
              <p className="text-muted-foreground">Products & services</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {project.productsServices.map((p) => (
                  <Badge key={p} variant="outline" className="font-mono text-caption">
                    {p}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
          {project?.goals?.length ? (
            <p>
              <span className="text-muted-foreground">Goals: </span>
              {project.goals.join(" · ")}
            </p>
          ) : null}
          {project?.competitors?.length ? (
            <p>
              <span className="text-muted-foreground">Competitors: </span>
              {project.competitors.join(" · ")}
            </p>
          ) : null}
          {project?.websiteScan?.gmb?.title && (
            <p className="text-muted-foreground">
              {project.websiteScan.gmb.title}
              {project.websiteScan.gmb.rating
                ? ` — ${project.websiteScan.gmb.rating}★ (${project.websiteScan.gmb.reviews ?? "?"} reviews)`
                : ""}
            </p>
          )}
          {!hasDetails && (
            <p className="text-muted-foreground">
              No products, goals or competitors saved yet.{" "}
              <button type="button" onClick={onEdit} className="font-medium text-foreground underline underline-offset-4">
                Add them in Edit project
              </button>
              .
            </p>
          )}
        </div>
      )}
      {personaCount === 0 && (
        <div className="mt-auto pt-4">
          <Button size="sm" variant="outline" onClick={quickGeneratePersona} disabled={generating}>
            {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Draft a persona with AI
          </Button>
        </div>
      )}
    </section>
  );
}

function ConnectionsSection({
  projectId,
  connected,
  canManage,
}: {
  projectId: Id<"projects">;
  connected: Set<string> | undefined;
  canManage: boolean;
}) {
  return (
    // Only verified connections belong on the project overview.
    <section aria-labelledby="connections-title" className="flex h-full flex-col rounded-lg border bg-card p-5 shadow-soft">
      <SectionHeading id="connections-title" title="Connected data" hint="Only verified connections are shown here." />
      {connected === undefined ? (
        <ModuleSkeleton label="Loading connections…" rows={1} />
      ) : connected.size ? (
        <ul className="flex flex-wrap gap-2">
          {DATA_PROVIDERS.filter((provider) => connected.has(provider.id)).map((provider) => (
            <li
              key={provider.id}
              className="flex items-center gap-1.5 rounded-md border border-terminal-green/40 bg-terminal-green-soft px-2.5 py-1.5 font-mono text-caption text-terminal-green-ink"
              title={provider.detail}
            >
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              {provider.label}
              <span className="sr-only"> — connected</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Plug className="size-4" />
          </span>
          <p className="font-mono text-caption text-muted-foreground">
            No data sources are connected yet.
            {canManage ? " Connect one in Grow when you’re ready." : ""}
          </p>
        </div>
      )}
      {canManage && (
        <div className="mt-auto pt-4">
          <Button asChild size="sm" variant="outline">
            <Link to={`/app/${projectId}/grow`}>
              Manage connections <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}

function ContentSection({
  projectId,
  content,
}: {
  projectId: Id<"projects">;
  content: ReturnType<typeof useContentList>;
}) {
  return (
    <section aria-labelledby="content-title">
      <SectionHeading
        id="content-title"
        title="Created content"
        hint="Briefs and drafts from Create land here."
        action={
          <Button asChild size="sm" variant="outline">
            <Link to={`/app/${projectId}/create`}>
              Open Create <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        }
      />
      {content === undefined ? (
        <ModuleSkeleton label="Loading content…" rows={2} />
      ) : content.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card/50 p-6 text-center">
          <PenTool aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 font-mono text-small font-medium">No content yet</p>
          <p className="mx-auto mt-1 max-w-md font-mono text-caption text-muted-foreground">
            Briefs and drafts you create land here.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {content.map((piece) => (
            <li
              key={piece._id}
              className="flex items-center gap-3 rounded-md border bg-card px-3 py-2.5 shadow-soft"
            >
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-tile-violet-soft text-tile-violet-ink">
                <MessageSquareText className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-small">{piece.title}</span>
              <StatusBadge status={piece.status} className="shrink-0" />
              <Button asChild size="icon-sm" variant="ghost" aria-label={`Download ${piece.title}`}>
                <a
                  href={`data:text/markdown;charset=utf-8,${encodeURIComponent(
                    `# ${piece.title}\n\n${piece.body ?? ""}`,
                  )}`}
                  download={`${piece.title.replace(/[^\w-]+/g, "-")}.md`}
                >
                  <Download className="size-3.5" />
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function useContentList(projectId: Id<"projects">) {
  return useQuery(api.content.list, { projectId });
}

/* ── Business understanding: the brief every AI feature is grounded in ──── */

function BusinessUnderstandingCard({
  project,
  onReview,
}: {
  project: ProjectDoc | undefined;
  onReview: () => void;
}) {
  if (!project) return null;
  const profile = project.businessProfile;
  if (profile?.status === "confirmed") {
    return (
      <section aria-labelledby="bu-title" className="grid gap-2 rounded-lg border bg-card p-5 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="bu-title" className="min-w-0 font-mono text-h3">Your business, as MOSAI understands it</h2>
          <div className="flex items-center gap-2">
            <BusinessUnderstandingStatus profile={profile} />
            <Button size="sm" variant="ghost" onClick={onReview}>Edit</Button>
          </div>
        </div>
        <p className="font-mono text-small text-muted-foreground">{profile.summary}</p>
        {profile.customerSegments.length ? (
          <p className="font-mono text-caption">Customers: {profile.customerSegments.join(" · ")}</p>
        ) : null}
      </section>
    );
  }
  return (
    <section
      aria-labelledby="bu-title"
      className="grid gap-3 rounded-lg border border-terminal-amber/40 bg-terminal-amber-soft p-5 shadow-soft"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bu-title" className="min-w-0 font-mono text-h3">
          {profile ? "Check MOSAI’s summary of your business" : "MOSAI is getting to know your business"}
        </h2>
        <BusinessUnderstandingStatus profile={profile} />
      </div>
      <p className="font-mono text-small text-foreground" role="status">
        {profile
          ? profile.summary
          : "No summary yet. If you’ve just created this project it’s being drafted now; otherwise open it and MOSAI will draft one."}
      </p>
      {profile?.customerSegments.length ? (
        <p className="font-mono text-caption">Customers: {profile.customerSegments.join(" · ")}</p>
      ) : null}
      <p className="font-mono text-caption text-muted-foreground">
        Customer profiles, content and your website are written for the customers in this summary — a minute here saves rewriting later.
      </p>
      <Button className="w-full sm:w-fit" onClick={onReview}>
        {profile ? "Review and confirm" : "Open it now"} <ArrowRight className="size-4" aria-hidden="true" />
      </Button>
    </section>
  );
}

/* ── Brand kit: how every AI writer sounds and what it may claim ────────── */

function BrandKitCard({ project, onOpen }: { project: ProjectDoc; onOpen: () => void }) {
  const brand = project.brandProfile;
  return (
    <section aria-labelledby="brand-title" className="grid gap-2 rounded-lg border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="brand-title" className="min-w-0 font-mono text-h3">Your brand</h2>
        <div className="flex items-center gap-2">
          <BrandStatus brand={brand} />
          <Button size="sm" variant={brand ? "ghost" : "outline"} onClick={onOpen}>
            {brand ? "Edit" : "Set it up"}
          </Button>
        </div>
      </div>
      {brand ? (
        <>
          {brand.promise ? <p className="font-mono text-small">{brand.promise}</p> : null}
          <p className="font-mono text-caption text-muted-foreground">
            {[
              brand.personality.length ? brand.personality.join(" · ") : "",
              brand.pillars.length ? `${brand.pillars.length} key message${brand.pillars.length === 1 ? "" : "s"}` : "",
            ].filter(Boolean).join(" — ")}
          </p>
          {Object.values(brand.colors).some(Boolean) ? (
            <ul className="flex gap-1.5" aria-label="Brand colours">
              {Object.entries(brand.colors).filter(([, hex]) => hex).map(([role, hex]) => (
                <li key={role} title={`${role} ${hex}`} className="size-5 rounded-full border" style={{ backgroundColor: hex }}>
                  <span className="sr-only">{role} {hex}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="font-mono text-caption text-muted-foreground">
          Set your promise, voice and colours once. Every post, page and email MOSAI writes will then sound like you and only claim what you can prove.
        </p>
      )}
    </section>
  );
}

/* ── Overview page ──────────────────────────────────────────────────────── */

export default function Overview({
  projectId,
  modules,
}: {
  projectId: Id<"projects">;
  modules: string[];
}) {
  const project = useQuery(api.projects.get, { id: projectId });
  // Readiness of the project-scoped capability matrix (same query the hook
  // and the route gate read; Convex dedupes it). Until it resolves,
  // `modules` is empty and must not be shown as "locked".
  const matrix = useQuery(api.entitlements.matrix, { projectId });
  const modulesLoading = matrix === undefined;
  const entitlements = useModuleEntitlements(projectId);
  const connections = useQuery(api.connections.list, { projectId });
  const files = useQuery(api.files.list, { projectId });
  const content = useContentList(projectId);
  const personas = useQuery(api.personas.list, { projectId });
  const journeysRequested = modules.includes("journeys");
  const journeys = useQuery(api.journeys.list, journeysRequested ? { projectId } : "skip");
  const pack = useQuery(api.projects.exportPack, { id: projectId });

  // `?edit=understanding|customers|details` opens Edit project on that tab
  // (used by toasts and the project menu).
  const [searchParams, setSearchParams] = useSearchParams();
  const editParam = searchParams.get("edit");
  const editTab =
    editParam === "customers" || editParam === "details" || editParam === "brand" ? editParam : "understanding";
  const openEdit = (tab: ProjectSettingsTab) =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("edit", tab);
      return next;
    });
  const closeEdit = () =>
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("edit");
      return next;
    });

  const connected = connections
    ? new Set(connections.filter((c) => c.status === "connected").map((c) => c.provider))
    : undefined;

  const downloadPack = () => {
    if (!pack) return;
    const blob = new Blob([pack.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project?.name ?? "project"}-pack.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Project pack downloaded");
  };

  // The server returns null when the project is gone or not yours.
  if (project === null) {
    return (
      <ModuleEmpty
        icon={FolderX}
        title="This project isn’t available"
        hint="It may have been deleted, or you no longer have access. Your other projects are safe."
        action={
          <Button asChild>
            <Link to="/app">Go to my projects</Link>
          </Button>
        }
      />
    );
  }

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const counts: Partial<Record<ModuleCardId, string>> = {};
  if (personas?.length) counts.understand = `${plural(personas.length, "profile", "profiles")} saved`;
  if (journeys?.length) counts.journeys = `${plural(journeys.length, "journey", "journeys")} saved`;
  if (content?.length) counts.create = `${plural(content.length, "piece", "pieces")} saved`;

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-8 pb-8 sm:gap-10"
    >
      <Reveal>
        <ModuleErrorBoundary>
          <WelcomeHeader
            project={project}
            stats={{
              personas: personas?.length,
              content: content?.length,
              files: files?.length,
              connected: connected?.size,
            }}
            onDownloadPack={downloadPack}
            packReady={Boolean(pack)}
            onEdit={() => openEdit("details")}
          />
        </ModuleErrorBoundary>
      </Reveal>

      <ProjectSettingsSheet
        projectId={projectId}
        open={editParam !== null}
        onOpenChange={(open) => (open ? openEdit(editTab) : closeEdit())}
        initialTab={editTab}
      />

      {/* U4 slot: the starter kit cards go here, above "This week". */}
      <ModuleErrorBoundary>
        <StarterKitCards
          projectId={projectId}
          modules={modules}
          modulesLoading={modulesLoading}
          onFixFacts={() => openEdit("understanding")}
        />
      </ModuleErrorBoundary>

      <ModuleErrorBoundary>
        <SinceYouWereAway projectId={projectId} />
      </ModuleErrorBoundary>

      <Reveal>
        <ModuleErrorBoundary>
          <ThisWeekNextStep
            projectId={projectId}
            project={project}
            modules={modules}
            modulesLoading={modulesLoading}
            personaCount={personas?.length}
            journeyCount={journeys?.length}
            contentCount={content?.length}
          />
        </ModuleErrorBoundary>
      </Reveal>

      <Reveal>
        <section id="modules" aria-labelledby="modules-title">
          <SectionHeading
            id="modules-title"
            title="Your tools"
            hint="Each works on its own and gets smarter with the others — they all share this project."
          />
          <ModuleErrorBoundary>
            <ModuleGrid
              projectId={projectId}
              modules={modules}
              loading={modulesLoading}
              stateOf={entitlements.stateOf}
              counts={counts}
            />
          </ModuleErrorBoundary>
        </section>
      </Reveal>

      {project ? (
        <Reveal>
          <ModuleErrorBoundary>
            <BusinessUnderstandingCard project={project} onReview={() => openEdit("understanding")} />
          </ModuleErrorBoundary>
        </Reveal>
      ) : null}

      {project ? (
        <Reveal>
          <ModuleErrorBoundary>
            <BrandKitCard project={project} onOpen={() => openEdit("brand")} />
          </ModuleErrorBoundary>
        </Reveal>
      ) : null}

      <Reveal className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ModuleErrorBoundary>
          <AboutSection project={project} personaCount={personas?.length} projectId={projectId} onEdit={() => openEdit("details")} />
        </ModuleErrorBoundary>
        <ModuleErrorBoundary>
          <ConnectionsSection projectId={projectId} connected={connected} canManage={modules.includes("grow")} />
        </ModuleErrorBoundary>
      </Reveal>

      <Reveal>
        <section aria-labelledby="files-title">
          <SectionHeading id="files-title" title="Attached files" hint="Files here enrich AI across every module." />
          <ModuleErrorBoundary>
            {files === undefined ? (
              <ModuleSkeleton label="Loading files…" rows={1} />
            ) : (
              <ProjectFilesSection projectId={projectId} files={files} />
            )}
          </ModuleErrorBoundary>
        </section>
      </Reveal>

      <Reveal>
        <ModuleErrorBoundary>
          <CommunicationsSection projectId={projectId} />
        </ModuleErrorBoundary>
      </Reveal>

      <Reveal>
        <ModuleErrorBoundary>
          <ContentSection projectId={projectId} content={content} />
        </ModuleErrorBoundary>
      </Reveal>
    </motion.div>
  );
}
