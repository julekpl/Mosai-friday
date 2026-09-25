import { useState, type ReactNode } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Download,
  FileDown,
  FolderX,
  Globe,
  LockKeyhole,
  Loader2,
  MapPin,
  Megaphone,
  MessageSquareText,
  PenTool,
  Pencil,
  Plug,
  Plus,
  Route,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";

import { MODULE_TILES, type TileName } from "@/components/mosaic";
import { MOSAI_EASE, MOTION } from "@/components/motion";
import {
  DATA_PROVIDERS,
  ModuleEmpty,
  ModuleErrorBoundary,
  ModuleSkeleton,
  StatusBadge,
} from "@/components/app/module-kit";
import { ProjectFilesSection } from "@/components/app/ProjectFiles";
import {
  BusinessUnderstandingStatus,
  ProjectSettingsSheet,
} from "@/components/app/ProjectSettings";
import { NextAction } from "@/components/app/NextAction";
import { getNextActionModel } from "@/components/app/next-action-model";
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
import { useAuth } from "@/hooks/use-auth";
import {
  capabilityStateLabel,
  useModuleEntitlements,
} from "@/hooks/use-module-entitlements";
import type { CapabilityState } from "@/convex/lib/capabilities";
import { displayDomain } from "@/lib/url";
import { cn } from "@/lib/utils";

/* ── Presentation tables ────────────────────────────────────────────────── */

/** Presentation only (icon, copy). Whether a module is unlocked is decided by
 *  the server's capability matrix, never by a tier column here. */
const MODULE_CARDS = [
  { to: "understand", icon: Search, name: "Understand", desc: "Who your customers are and what they need" },
  { to: "journeys", icon: Route, name: "Journeys", desc: "How people go from hearing about you to buying" },
  { to: "create", icon: PenTool, name: "Create", desc: "Posts, articles and emails, written with AI" },
  { to: "build", icon: Blocks, name: "Build", desc: "Your website or app, made from your business details" },
  { to: "customers", icon: Users, name: "Customers", desc: "Your contacts, who agreed to hear from you, and follow-ups" },
  { to: "promote", icon: Megaphone, name: "Promote", desc: "Social posts, campaigns and ads" },
  { to: "sell", icon: ShoppingBag, name: "Sell", desc: "Your products, ready for your site and ads" },
  { to: "grow", icon: TrendingUp, name: "Grow", desc: "What is working, with where each number came from" },
] as const;

type ModuleCardId = (typeof MODULE_CARDS)[number]["to"];

/** Static class sets per tile so Tailwind can see every class. `ink` is the
 *  AA-safe text/icon tone; `solid` is decoration only. */
const TILE_CLASSES: Record<TileName, { soft: string; ink: string; solid: string; hoverBorder: string }> = {
  teal: { soft: "bg-tile-teal-soft", ink: "text-tile-teal-ink", solid: "bg-tile-teal", hoverBorder: "hover:border-tile-teal/60" },
  coral: { soft: "bg-tile-coral-soft", ink: "text-tile-coral-ink", solid: "bg-tile-coral", hoverBorder: "hover:border-tile-coral/60" },
  violet: { soft: "bg-tile-violet-soft", ink: "text-tile-violet-ink", solid: "bg-tile-violet", hoverBorder: "hover:border-tile-violet/60" },
  sky: { soft: "bg-tile-sky-soft", ink: "text-tile-sky-ink", solid: "bg-tile-sky", hoverBorder: "hover:border-tile-sky/60" },
  rose: { soft: "bg-tile-rose-soft", ink: "text-tile-rose-ink", solid: "bg-tile-rose", hoverBorder: "hover:border-tile-rose/60" },
  lime: { soft: "bg-tile-lime-soft", ink: "text-tile-lime-ink", solid: "bg-tile-lime", hoverBorder: "hover:border-tile-lime/60" },
  amber: { soft: "bg-tile-amber-soft", ink: "text-tile-amber-ink", solid: "bg-tile-amber", hoverBorder: "hover:border-tile-amber/60" },
};

function tileFor(moduleId: ModuleCardId) {
  return TILE_CLASSES[MODULE_TILES[moduleId]];
}

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

/* ── Next best action ───────────────────────────────────────────────────── */

function NextActionSkeleton() {
  return (
    <div role="status" className="grid grid-cols-1 gap-6 rounded-xl border bg-card p-5 shadow-soft md:grid-cols-2 md:p-7">
      <span className="sr-only">Finding a useful next step…</span>
      <div aria-hidden="true" className="grid content-start gap-3">
        <span className="h-6 w-40 animate-pulse rounded-full bg-muted" />
        <span className="h-8 w-3/4 animate-pulse rounded-md bg-muted" />
        <span className="h-4 w-full animate-pulse rounded-sm bg-muted" />
        <span className="mt-4 h-10 w-40 animate-pulse rounded-md bg-muted" />
      </div>
      <div aria-hidden="true" className="grid gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </div>
  );
}

function OverviewNextAction({
  projectId,
  modules,
  personaCount,
  journeyCount,
  contentCount,
  journeysRequested,
  modulesLoading,
}: {
  projectId: Id<"projects">;
  modules: string[];
  personaCount: number | undefined;
  journeyCount: number | undefined;
  contentCount: number | undefined;
  journeysRequested: boolean;
  modulesLoading: boolean;
}) {
  if (
    modulesLoading ||
    personaCount === undefined ||
    contentCount === undefined ||
    (journeysRequested && journeyCount === undefined)
  ) {
    return <NextActionSkeleton />;
  }

  return (
    <NextAction
      projectId={projectId}
      model={getNextActionModel({
        personaCount,
        journeyCount: journeyCount ?? 0,
        contentCount,
        modules,
      })}
    />
  );
}

/* ── Module grid ────────────────────────────────────────────────────────── */

function ModuleCard({
  card,
  projectId,
  state,
  savedLabel,
}: {
  card: (typeof MODULE_CARDS)[number];
  projectId: Id<"projects">;
  state: CapabilityState;
  savedLabel?: string;
}) {
  const tile = tileFor(card.to);
  const Icon = card.icon;
  const included = state === "included";
  const unavailable = state === "unavailable";
  // Locked modules go straight to plan options; needs_setup opens the
  // module (the route gate decides); unavailable is not a link at all.
  const to = included ? `/app/${projectId}/${card.to}` : state === "locked" ? "/app/billing" : `/app/${projectId}/${card.to}`;

  const body = (
    <>
      {/* Tile band + decorative corner mosaic */}
      <span aria-hidden="true" className={cn("absolute inset-x-0 top-0 h-1", tile.solid, !included && "opacity-40")} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-4 top-5 grid grid-cols-2 gap-1 opacity-30 transition-transform duration-300 ease-mosaic group-hover:-translate-x-1 group-hover:translate-y-1 group-hover:rotate-6"
      >
        <span className={cn("size-3 rounded-xs", tile.solid)} />
        <span className={cn("size-3 rounded-xs", tile.solid)} />
        <span className="size-3" />
        <span className={cn("size-3 rounded-xs", tile.solid)} />
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "grid size-11 place-items-center rounded-lg transition-transform duration-300 ease-mosaic group-hover:-rotate-6 group-hover:scale-105",
          included ? [tile.soft, tile.ink] : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" />
      </span>
      <h3 className="mt-4 font-mono text-h3">{card.name}</h3>
      <p className="mt-1 font-mono text-caption text-muted-foreground">{card.desc}</p>

      <span className="mt-auto flex items-center gap-2 pt-5 font-mono text-caption">
        {included ? (
          <>
            <span className={cn("font-medium", tile.ink)}>{savedLabel ?? "Open"}</span>
            <ArrowRight
              aria-hidden="true"
              className={cn("ml-auto size-4 transition-transform duration-200 ease-terminal group-hover:translate-x-1", tile.ink)}
            />
          </>
        ) : (
          <>
            <LockKeyhole aria-hidden="true" className="size-3.5 text-terminal-amber-ink" />
            <span className="text-muted-foreground">
              {state === "locked" ? "Not on your plan · see options" : capabilityStateLabel(state)}
            </span>
          </>
        )}
      </span>
    </>
  );

  const shell = "group relative flex h-full min-h-44 flex-col overflow-hidden rounded-lg border bg-card p-5 shadow-soft";

  if (unavailable) {
    return (
      <div className={cn(shell, "opacity-90")} aria-label={`${card.name} — unavailable`}>
        {body}
      </div>
    );
  }

  return (
    <Link
      to={to}
      aria-label={
        included
          ? `Open ${card.name}${savedLabel ? ` — ${savedLabel}` : ""}`
          : `${card.name} — ${capabilityStateLabel(state)}${state === "locked" ? ", view plan options" : ""}`
      }
      className={cn(shell, "hover-lift focus-ring", included && tile.hoverBorder)}
    >
      {body}
    </Link>
  );
}

function ModuleGridSkeleton() {
  return (
    <div role="status" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <span className="sr-only">Loading your modules…</span>
      {MODULE_CARDS.map((m) => (
        <div key={m.to} aria-hidden="true" className="h-44 animate-pulse rounded-lg border bg-card shadow-soft" />
      ))}
    </div>
  );
}

function ModuleGrid({
  projectId,
  modules,
  loading,
  stateOf,
  counts,
}: {
  projectId: Id<"projects">;
  modules: string[];
  loading: boolean;
  stateOf: (module: string) => CapabilityState | null;
  counts: Partial<Record<ModuleCardId, string>>;
}) {
  if (loading) return <ModuleGridSkeleton />;

  const stateFor = (id: string): CapabilityState =>
    modules.includes(id) ? "included" : (stateOf(id) ?? "locked");

  if (MODULE_CARDS.every((m) => stateFor(m.to) !== "included")) {
    return (
      <ModuleEmpty
        icon={LockKeyhole}
        title="No modules are included on your plan yet"
        hint="Your project details are saved. Choose a plan to unlock Understand, Create, Build and the rest."
        action={
          <Button asChild>
            <Link to="/app/billing">
              View plan options <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <motion.ul
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      {MODULE_CARDS.map((card) => (
        <motion.li key={card.to} variants={riseIn} className="min-w-0">
          <ModuleCard
            card={card}
            projectId={projectId}
            state={stateFor(card.to)}
            savedLabel={counts[card.to]}
          />
        </motion.li>
      ))}
    </motion.ul>
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
          AI drafts the core message, rationale, audience and channels. It MAY
          feed downstream modules — content, campaigns — when you want it to.
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
        hint="Your core messages, drafted with AI and kept as drafts."
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
                  <StatusBadge status={c.status} />
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
    editParam === "customers" || editParam === "details" ? editParam : "understanding";
  const openEdit = (tab: "understanding" | "customers" | "details") =>
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

      {project ? (
        <Reveal>
          <ModuleErrorBoundary>
            <BusinessUnderstandingCard project={project} onReview={() => openEdit("understanding")} />
          </ModuleErrorBoundary>
        </Reveal>
      ) : null}

      <Reveal>
        <ModuleErrorBoundary>
          <OverviewNextAction
            projectId={projectId}
            modules={modules}
            personaCount={personas?.length}
            journeyCount={journeys?.length}
            contentCount={content?.length}
            journeysRequested={journeysRequested}
            modulesLoading={modulesLoading}
          />
        </ModuleErrorBoundary>
      </Reveal>

      <Reveal>
        <section id="modules" aria-labelledby="modules-title">
          <SectionHeading
            id="modules-title"
            title="Your modules"
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
