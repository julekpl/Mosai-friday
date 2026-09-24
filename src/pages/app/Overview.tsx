import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  ArrowRight,
  Blocks,
  CheckCircle2,
  Download,
  FileDown,
  Loader2,
  Megaphone,
  MessageSquareText,
  PenTool,
  Plus,
  Route,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import { moduleTileBg, moduleTileText } from "@/components/mosaic";
import {
  DATA_PROVIDERS,
  ModuleEmpty,
  ModuleErrorBoundary,
  ModuleSkeleton,
  StatusBadge,
} from "@/components/app/module-kit";
import { ProjectFilesSection } from "@/components/app/ProjectFiles";
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
import { cn } from "@/lib/utils";

/** Presentation only (icon, copy). Whether a module is unlocked is decided by
 *  the server's capability matrix, never by a tier column here. */
const MODULE_CARDS = [
  {
    to: "understand",
    icon: Search,
    name: "Understand",
    desc: "Personas, buyer profiles, journeys and evidence",
  },
  {
    to: "journeys",
    icon: Route,
    name: "Journeys",
    desc: "Journey maps — stages, lanes and the experience curve",
  },
  {
    to: "create",
    icon: PenTool,
    name: "Create",
    desc: "Gaps, topics, briefs and content generation",
  },
  {
    to: "build",
    icon: Blocks,
    name: "Build",
    desc: "Websites & apps from personas, with SEO/WCAG checks",
  },
  {
    to: "customers",
    icon: Users,
    name: "Customers",
    desc: "CRM, consent, segments — owned here, not by a vendor",
  },
  {
    to: "promote",
    icon: Megaphone,
    name: "Promote",
    desc: "Campaigns, social scheduling, ads",
  },
  {
    to: "sell",
    icon: ShoppingBag,
    name: "Sell",
    desc: "Products and product feeds for ads + website",
  },
  {
    to: "grow",
    icon: TrendingUp,
    name: "Grow",
    desc: "Insights with source & freshness, no blended scores",
  },
] as const;

function OverviewNextAction({
  projectId,
  modules,
}: {
  projectId: Id<"projects">;
  modules: string[];
}) {
  const personas = useQuery(api.personas.list, { projectId });
  const journeys = useQuery(
    api.journeys.list,
    modules.includes("journeys") ? { projectId } : "skip",
  );
  const content = useQuery(api.content.list, { projectId });

  if (
    personas === undefined ||
    content === undefined ||
    (modules.includes("journeys") && journeys === undefined)
  ) {
    return <ModuleSkeleton label="Finding a useful next step…" />;
  }

  return (
    <NextAction
      projectId={projectId}
      model={getNextActionModel({
        personaCount: personas.length,
        journeyCount: journeys?.length ?? 0,
        contentCount: content.length,
        modules,
      })}
    />
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
        <div className="grid gap-2">
          <Label>Should influence (optional)</Label>
          <div className="flex flex-wrap gap-1.5">
            {COMMS_INFLUENCE_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => toggleInfluence(opt)}
                className={cn(
                  "rounded-full border px-2.5 py-1 font-mono text-caption ease-terminal",
                  influence.includes(opt)
                    ? "border-terminal-green/40 bg-terminal-green-soft text-terminal-green"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
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
  const comms = useQuery(api.communications.list, { projectId }) ?? [];
  const update = useMutation(api.communications.update);
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-mono text-h3">Marketing communications</h2>
        <Button size="sm" variant="outline" className="ml-auto" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" /> New with AI
        </Button>
      </div>
      {comms.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-center font-mono text-caption text-muted-foreground">
          None yet — AI can draft your core messages from project details,
          personas and files.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {comms.map((c) => (
            <div key={c._id} className="rounded-md border bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <p className="font-mono text-small font-medium">{c.name}</p>
                <div className="flex shrink-0 items-center gap-1">
                  <StatusBadge status={c.status} />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Archive"
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
              {c.channels?.length && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {c.channels.map((ch) => (
                    <Badge key={ch} variant="outline" className="font-mono text-caption">
                      {ch}
                    </Badge>
                  ))}
                </div>
              )}
              {c.rationale && (
                <p className="mt-2 font-mono text-caption text-muted-foreground">
                  {c.rationale}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <CommsDialog projectId={projectId} onOpenChange={setOpen} />
      </Dialog>
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
  const connections = useQuery(api.connections.list, { projectId }) ?? [];
  const files = useQuery(api.files.list, { projectId }) ?? [];
  const content = useQuery(api.content.list, { projectId }) ?? [];
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const pack = useQuery(api.projects.exportPack, { id: projectId });

  const generate = useAction(api.ai.generatePersona);
  const createPersona = useMutation(api.personas.create);
  const [generating, setGenerating] = useState(false);

  const connected = new Set(
    connections.filter((c) => c.status === "connected").map((c) => c.provider),
  );

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

  return (
    <div className="animate-mosaic-in">
      <ModuleHeader
        icon={Search}
        title={project?.name ?? "Project"}
        subtitle={
          project?.description ??
          "The container for personas, content, connections and every module."
        }
      >
        <div className="flex gap-2">
          <Button variant="outline" onClick={downloadPack} disabled={!pack}>
            <FileDown className="size-4" /> Download pack
          </Button>
          <Badge variant="outline" className="h-9 items-center font-mono text-caption">
            {project?.industry ?? "no industry set"}
          </Badge>
        </div>
      </ModuleHeader>

      <ModuleErrorBoundary>
        <OverviewNextAction projectId={projectId} modules={modules} />
      </ModuleErrorBoundary>

      {/* Project details */}
      <section className="mb-8 grid gap-4 rounded-md border bg-card p-4 shadow-card md:grid-cols-2">
        <div className="grid gap-1.5">
          <p className="font-mono text-caption text-muted-foreground">details</p>
          {project?.websiteUrl && (
            <p className="font-mono text-caption">
              web:{" "}
              <a
                href={project.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-terminal-green hover:underline"
              >
                {project.websiteUrl}
              </a>
            </p>
          )}
          {project?.googleBusinessName && (
            <p className="font-mono text-caption">
              gmb: {project.googleBusinessName}
            </p>
          )}
          {project?.productsServices?.length ? (
            <div className="mt-1 flex flex-wrap gap-1">
              {project.productsServices.map((p) => (
                <Badge
                  key={p}
                  variant="outline"
                  className="font-mono text-caption text-terminal-green"
                >
                  {p}
                </Badge>
              ))}
            </div>
          ) : null}
          {project?.goals?.length ? (
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              goals: {project.goals.join(" · ")}
            </p>
          ) : null}
          {project?.competitors?.length ? (
            <p className="font-mono text-caption text-muted-foreground">
              competitors: {project.competitors.join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1.5">
          <p className="font-mono text-caption text-muted-foreground">
            snapshot
          </p>
          <p className="font-mono text-caption">
            personas: {personas.length} · content: {content.length} · files:{" "}
            {files.length}
          </p>
          {project?.websiteScan?.gmb?.title && (
            <p className="font-mono text-caption text-muted-foreground">
              {project.websiteScan.gmb.title}
              {project.websiteScan.gmb.rating
                ? ` — ${project.websiteScan.gmb.rating}★ (${project.websiteScan.gmb.reviews ?? "?"} reviews)`
                : ""}
            </p>
          )}
          {personas.length === 0 && (
            <Button
              size="sm"
              variant="outline"
              className="mt-1 w-fit"
              onClick={quickGeneratePersona}
              disabled={generating}
            >
              {generating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Generate a persona with AI
            </Button>
          )}
        </div>
      </section>

      {/* Attached files */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-mono text-h3">Attached files</h2>
          <span className="font-mono text-caption text-muted-foreground">
            enrich AI across every module
          </span>
        </div>
        <ProjectFilesSection projectId={projectId} files={files} />
      </section>

      {/* Communications */}
      <CommunicationsSection projectId={projectId} />

      {/* Created content */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-mono text-h3">Created content</h2>
          <Button asChild size="sm" variant="outline" className="ml-auto">
            <Link to={`/app/${projectId}/create`}>
              Open Create module <ArrowRight className="size-3.5" />
            </Link>
          </Button>
        </div>
        {content.length === 0 ? (
          <p className="rounded-md border border-dashed p-4 text-center font-mono text-caption text-muted-foreground">
            No content yet — briefs and drafts you create land here.
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {content.map((piece) => (
              <li
                key={piece._id}
                className="flex items-center gap-2 rounded-sm border bg-card px-3 py-2"
              >
                <MessageSquareText className="size-4 shrink-0 text-terminal-green" />
                <span className="min-w-0 truncate font-mono text-caption">
                  {piece.title}
                </span>
                <StatusBadge status={piece.status} className="ml-auto shrink-0" />
                <Button
                  asChild
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Download ${piece.title}`}
                >
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

      {/* Data connections */}
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="font-mono text-h3">Data connections</h2>
          <span className="font-mono text-caption text-muted-foreground">
            {connected.size}/{DATA_PROVIDERS.length} connected
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {DATA_PROVIDERS.map((p) => {
            const isConnected = connected.has(p.id);
            return (
              <span
                key={p.id}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-caption",
                  isConnected
                    ? "border-terminal-green/40 bg-terminal-green-soft text-terminal-green"
                    : "text-muted-foreground",
                )}
                title={p.detail}
              >
                {isConnected && <CheckCircle2 className="size-3.5" />}
                {p.label}
              </span>
            );
          })}
        </div>
      </section>

      {/* Modules */}
      <section id="modules">
        <h2 className="mb-3 font-mono text-h3">Modules</h2>
        {modules.length === 0 ? (
          <ModuleEmpty
            icon={Blocks}
            title="No modules on your plan"
            hint="Upgrade in Plan & billing to unlock Build, Customers, Promote, Sell and Grow."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODULE_CARDS.map((m, i) => {
              // `modules` is the server's resolved `included` list for this
              // project's organization and the caller's role.
              const locked = !modules.includes(m.to);
              return (
                <Link
                  key={m.to}
                  to={`/app/${projectId}/${m.to}`}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className="group animate-mosaic-in rounded-md border bg-card p-4 shadow-card transition-all duration-300 ease-mosaic hover:-translate-y-1 hover:rotate-[-0.4deg] hover:scale-[1.02] hover:border-terminal-green/50 hover:shadow-pop"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        "grid size-9 place-items-center rounded-md transition-transform duration-300 ease-mosaic",
                        "group-hover:scale-110 group-hover:-rotate-6",
                      )}
                    >
                      <m.icon className={cn("size-5", moduleTileText(m.to))} />
                    </span>
                    {locked && (
                      <Badge
                        variant="outline"
                        className="font-mono text-caption text-terminal-amber"
                      >
                        upgrade
                      </Badge>
                    )}
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 font-mono text-small font-medium">
                    <span
                      className={cn(
                        "size-1.5 rounded-full transition-transform duration-300 ease-mosaic group-hover:scale-150",
                        moduleTileBg(m.to),
                      )}
                    />
                    {m.name}
                  </p>
                  <p className="mt-1 font-mono text-caption text-muted-foreground">
                    {m.desc}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
