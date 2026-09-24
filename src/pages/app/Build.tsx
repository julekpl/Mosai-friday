import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Blocks,
  CheckCircle2,
  Circle,
  CircleDot,
  FileText,
  Globe,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  Wand2,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import {
  ConfirmDelete,
  ModuleEmpty,
  StatusBadge,
} from "@/components/app/module-kit";
import { SitePanel } from "@/components/cms/SitePanel";
import { BuildWorkspace } from "@/components/build/BuildWorkspace";
import { AppWorkspace } from "@/components/build/AppWorkspace";
import { ContextInspector } from "@/components/app/ContextInspector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sanitizeHtml } from "@/lib/sanitize";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const KINDS = ["website", "app"] as const;

type BuildRow = {
  _id: Id<"builds">;
  projectId: Id<"projects">;
  name: string;
  kind: "website" | "app";
  status: "draft" | "generated" | "published";
  pages?: string[];
  idea?: string;
  positioning?: string;
  goals?: string[];
  personaIds?: Id<"personas">[];
  journeyMapIds?: Id<"journeyMaps">[];
  differentiators?: string[];
  blueprint?: {
    summary?: string;
    steps?: Array<{
      step: string;
      title: string;
      detail: string;
      status?: "todo" | "doing" | "done";
    }>;
    generatedAt: number;
  };
  appRequirements?: {
    state: "draft" | "reviewed";
    audience: "customer_facing" | "internal_team" | "both";
    goal: string;
    targetUsers: string;
    coreWorkflows: string[];
    constraints: string[];
    sourceRefs: Array<
      | { kind: "persona"; id: Id<"personas">; label: string; sourceVersion: string }
      | { kind: "journeyMap"; id: Id<"journeyMaps">; label: string; sourceVersion: string }
      | { kind: "contentPiece"; id: Id<"contentPieces">; label: string; sourceVersion: string }
    >;
    reviewedAt?: number;
    reviewedBy?: Id<"users">;
  };
  seoReady?: boolean;
  wcagReady?: boolean;
  createdAt: number;
};

type PersonaRow = {
  _id: Id<"personas">;
  name: string;
  role?: string;
  goals?: string[];
  pains?: string[];
  objections?: string[];
};

type JourneyRow = {
  _id: Id<"journeyMaps">;
  name: string;
  personaId?: Id<"personas">;
  stages?: Array<{ stage: string; score?: number }>;
};

/* ── New build: idea-first ─────────────────────────────────────────────── */

function NewBuildForm({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const create = useMutation(api.builds.create);
  const plan = useAction(api.buildPlan.generateBuildPlan);
  const update = useMutation(api.builds.update);
  const createPage = useMutation(api.buildPages.create);
  const saveAppRequirements = useMutation(api.builds.saveAppRequirements);
  const personas = (useQuery(api.personas.list, { projectId }) ?? []) as PersonaRow[];
  const journeys = (useQuery(api.journeys.list, { projectId }) ?? []) as JourneyRow[];

  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("website");
  const [appAudience, setAppAudience] = useState<"" | "customer_facing" | "internal_team" | "both">("");
  const [idea, setIdea] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !idea.trim()) return;
    setIsSaving(true);
    try {
      const buildId = await create({
        projectId,
        name: name.trim(),
        kind,
        idea: idea.trim(),
        ...(kind === "website" ? {
          personaIds: personas.map((p) => p._id),
          journeyMapIds: journeys.map((j) => j._id),
        } : {}),
      });

      if (kind === "app") {
        await saveAppRequirements({
          buildId,
          requirements: {
            audience: appAudience as "customer_facing" | "internal_team" | "both",
            goal: idea.trim(),
            targetUsers: "",
            coreWorkflows: [],
            constraints: [],
            sourceRefs: [],
          },
        });
        toast.success("App workspace created", {
          description: "Your app brief is ready to edit and review. No code was generated or run.",
        });
        onDone();
        return;
      }

      // Strategy-first: generate the plan immediately from idea + personas
      // + journeys, then persist positioning/goals/differentiators/pages.
      try {
        const result = await plan({ projectId, buildId });

        await update({
          id: buildId,
          positioning: result.positioning,
          goals: result.goals,
          differentiators: result.differentiators,
          blueprint: {
            summary: result.summary,
            steps: result.steps,
            generatedAt: Date.now(),
          },
        });
        for (const p of result.pages) {
          await createPage({
            buildId,
            name: p.name,
            path: p.path,
            goal: p.goal,
            personaId:
              p.personaId &&
              personas.some((x) => x._id === (p.personaId as Id<"personas">))
                ? (p.personaId as Id<"personas">)
                : undefined,
            journeyStage: p.journeyStage,
          });
        }
        toast.success("Build planned", {
          description:
            "Blueprint generated from your idea, personas and journeys. Review it on the Plan tab.",
        });
      } catch (e) {
        toast.warning("Build created — plan generation failed", {
          description:
            e instanceof Error
              ? e.message
              : "You can generate the blueprint later from the Plan tab.",
        });
      }
      onDone();
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
      setIsSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="nb-name">Build name</Label>
        <Input
          id="nb-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Marketing site"
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="nb-kind">Type</Label>
        <select
          id="nb-kind"
          className="h-9 cursor-pointer rounded-md border bg-card px-3 font-mono text-small"
          value={kind}
          onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      {kind === "app" && (
        <div className="grid gap-2">
          <Label htmlFor="nb-audience">Who is this app for?</Label>
          <select
            id="nb-audience"
            className="h-9 cursor-pointer rounded-md border bg-card px-3 font-mono text-small"
            value={appAudience}
            onChange={(e) => setAppAudience(e.target.value as typeof appAudience)}
          >
            <option value="">Choose an audience</option>
            <option value="customer_facing">Customers</option>
            <option value="internal_team">Internal team</option>
            <option value="both">Customers and internal team</option>
          </select>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="nb-idea">The idea</Label>
        <Textarea
          id="nb-idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder={kind === "app" ? "What should this app help its users do?" : "What should this website achieve for the business and its visitors?"}
          rows={4}
        />
        <p className="font-mono text-caption text-muted-foreground">
          {kind === "app"
            ? "This creates an editable app requirements brief. Choose its audience explicitly; app generation, execution and deployment are not available yet."
            : "The plan uses this idea with your personas and journeys to outline positioning, pages and differentiators before website content."}
        </p>
      </div>
      {personas.length === 0 && (
        <p className="rounded-md border border-terminal-amber/40 bg-terminal-amber-soft px-3 py-2 font-mono text-caption text-terminal-amber">
          No personas yet — add some in Understand for a grounded plan.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving || !name.trim() || !idea.trim() || (kind === "app" && !appAudience)}
        >
          {isSaving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {kind === "app" ? "Create app brief" : "Plan build"}
        </Button>
      </div>
    </div>
  );
}

/* ── Plan tab: positioning + differentiators + step list ───────────────── */

function PlanTab({ build }: { build: BuildRow }) {
  const update = useMutation(api.builds.update);
  const setStepStatus = useMutation(api.builds.setStepStatus);
  const plan = useAction(api.buildPlan.generateBuildPlan);
  const [regenerating, setRegenerating] = useState(false);

  const regenerate = async () => {
    if (!build.idea) return;
    setRegenerating(true);
    try {
      const result = await plan({ projectId: build.projectId, buildId: build._id });
      await update({
        id: build._id,
        positioning: result.positioning,
        goals: result.goals,
        differentiators: result.differentiators,
        blueprint: {
          summary: result.summary,
          steps: result.steps,
          generatedAt: Date.now(),
        },
      });
      toast.success("Blueprint regenerated");
    } catch (e) {
      toast.error("Plan failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setRegenerating(false);
    }
  };

  const steps = build.blueprint?.steps ?? [];

  return (
    <div className="grid gap-4">
      <ContextInspector projectId={build.projectId} buildId={build._id} />
      {build.blueprint?.summary && (
        <div className="rounded-md border bg-card p-4 shadow-card">
          <p className="font-mono text-caption text-muted-foreground">blueprint</p>
          <p className="mt-1 font-mono text-small">{build.blueprint.summary}</p>
        </div>
      )}

      {build.positioning ? (
        <div className="rounded-md border border-terminal-green/40 bg-terminal-green-soft p-4">
          <p className="flex items-center gap-1.5 font-mono text-caption text-terminal-green">
            <Target className="size-3.5" /> positioning
          </p>
          <p className="mt-1 font-mono text-small font-medium">{build.positioning}</p>
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="font-mono text-caption text-muted-foreground">
            No blueprint yet.
          </p>
          <Button
            className="mt-3"
            onClick={regenerate}
            disabled={regenerating || !build.idea}
          >
            {regenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            Generate blueprint
          </Button>
        </div>
      )}

      {build.differentiators && build.differentiators.length > 0 && (
        <div>
          <p className="font-mono text-caption text-muted-foreground">
            why this wins
          </p>
          <ul className="mt-2 grid gap-1.5">
            {build.differentiators.map((d, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-md border bg-card px-3 py-2 font-mono text-caption shadow-card"
              >
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-terminal-green" />
                {d}
              </li>
            ))}
          </ul>
        </div>
      )}

      {steps.length > 0 && (
        <div>
          <p className="font-mono text-caption text-muted-foreground">
            optimal steps
          </p>
          <div className="mt-2 grid gap-1.5">
            {steps.map((s, i) => (
              <button
                key={i}
                type="button"
                onClick={() =>
                  void setStepStatus({
                    id: build._id,
                    stepIndex: i,
                    status: s.status === "done" ? "todo" : "done",
                  }).catch((e: unknown) =>
                    toast.error("Update failed", {
                      description: e instanceof Error ? e.message : "Try again.",
                    }),
                  )
                }
                className="flex cursor-pointer items-start gap-2 rounded-md border bg-card px-3 py-2 text-left shadow-card transition-colors ease-terminal hover:bg-accent"
              >
                {s.status === "done" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-terminal-green" />
                ) : s.status === "doing" ? (
                  <CircleDot className="mt-0.5 size-4 shrink-0 text-terminal-amber" />
                ) : (
                  <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                )}
                <span>
                  <span className="font-mono text-small font-medium">{s.title}</span>
                  <span className="block font-mono text-caption text-muted-foreground">
                    {s.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Site tab: native CMS (W1 foundation) ─────────────────────────────── */

function SiteTab({ projectId }: { projectId: Id<"projects"> }) {
  const site = useQuery(api.cms.getSite, { projectId });
  const createSite = useMutation(api.cms.createSite);

  if (site === undefined) {
    return (
      <p className="font-mono text-caption text-muted-foreground">loading site…</p>
    );
  }
  if (site === null) {
    return (
      <div className="rounded-md border border-dashed p-10 text-center">
        <Globe className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 font-mono text-small font-medium">No site yet</p>
        <p className="mx-auto mt-1 max-w-md font-mono text-caption text-muted-foreground">
          Create your site to get a homepage, pages, navigation, assets and
          publishing — with drafts and version history built in.
        </p>
        <Button
          className="mt-4"
          onClick={() =>
            void createSite({ projectId, name: "" }).catch((e: unknown) =>
              toast.error("Create failed", {
                description: e instanceof Error ? e.message : "Try again.",
              }),
            )
          }
        >
          <Sparkles className="size-4" /> Create site
        </Button>
      </div>
    );
  }
  return <SitePanel projectId={projectId} site={site} />;
}

/* ── Pages tab: per-page drafts grounded in persona × journey stage ────── */

function PagesTab({ build }: { build: BuildRow }) {
  const pages = useQuery(api.buildPages.list, { buildId: build._id }) ?? [];
  const updatePage = useMutation(api.buildPages.update);
  const createPage = useMutation(api.buildPages.create);
  const draft = useAction(api.buildPlan.generatePageDraft);
  const personas = (useQuery(api.personas.list, { projectId: build.projectId }) ?? []) as PersonaRow[];

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [goal, setGoal] = useState("");
  const [busyPage, setBusyPage] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const generate = async (pageId: Id<"buildPages">, pageName: string) => {
    const page = pages.find((p) => p._id === pageId);
    if (!page) return;
    setBusyPage(pageId);
    try {
      const html = await draft({ projectId: build.projectId, pageId: page._id });
      await updatePage({ id: pageId, draft: html, status: "drafted" });
      toast.success(`Draft ready: ${pageName}`);
    } catch (e) {
      toast.error("Draft failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusyPage(null);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="size-3.5" /> Add page
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">Add page</DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Tie the page to a persona and journey stage so the draft is grounded.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="bp-name">Page name</Label>
                <Input
                  id="bp-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Pricing"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bp-path">Path</Label>
                <Input
                  id="bp-path"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/pricing"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bp-goal">Goal</Label>
                <Textarea
                  id="bp-goal"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={2}
                  placeholder="What must this page achieve?"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!name.trim()}
                  onClick={async () => {
                    await createPage({
                      buildId: build._id,
                      name: name.trim(),
                      path: path.trim() || `/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
                      goal: goal.trim() || undefined,
                    });
                    setName("");
                    setPath("");
                    setGoal("");
                    setOpen(false);
                  }}
                >
                  Add
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {pages.length === 0 ? (
        <ModuleEmpty
          icon={FileText}
          title="No pages planned"
          hint="Generate a blueprint on the Plan tab — it proposes pages tied to personas and journey stages."
        />
      ) : (
        pages.map((p) => {
          const persona = personas.find((x) => x._id === p.personaId);
          return (
            <div
              key={p._id}
              className="rounded-md border bg-card p-4 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-small font-medium">{p.name}</p>
                <Badge
                  variant="outline"
                  className="font-mono text-caption text-muted-foreground"
                >
                  {p.path}
                </Badge>
                {persona && (
                  <Badge
                    variant="outline"
                    className="font-mono text-caption text-terminal-blue"
                  >
                    {persona.name}
                  </Badge>
                )}
                {p.journeyStage && (
                  <Badge
                    variant="outline"
                    className="font-mono text-caption text-terminal-green"
                  >
                    {p.journeyStage}
                  </Badge>
                )}
                <StatusBadge status={p.status ?? "pending"} />
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyPage === p._id}
                    onClick={() => generate(p._id, p.name)}
                  >
                    {busyPage === p._id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="size-3.5" />
                    )}
                    Draft
                  </Button>
                  {p.draft && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPreview(p.draft ?? null)}
                    >
                      View
                    </Button>
                  )}
                </div>
              </div>
              {p.goal && (
                <p className="mt-1.5 font-mono text-caption text-muted-foreground">
                  {p.goal}
                </p>
              )}
            </div>
          );
        })
      )}

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">Page draft</DialogTitle>
          </DialogHeader>
          <div
            className="prose prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview) }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Main module ───────────────────────────────────────────────────────── */

export default function Build({ projectId }: { projectId: Id<"projects"> }) {
  const builds = useQuery(api.builds.list, { projectId }) ?? [];
  const remove = useMutation(api.builds.remove);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<Id<"builds"> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BuildRow | null>(null);
  const [managing, setManaging] = useState(false);

  const selected = builds.find((b) => b._id === selectedId) ?? null;

  if (selected && managing && selected.kind === "website") {
    // Classic management surface: strategy blueprint + full CMS site panel.
    return (
      <div>
        <ModuleHeader
          icon={Globe}
          title={`${selected.name} · manage`}
          subtitle="Blueprint, personas-grounded page plans and the full CMS surface"
        >
          <StatusBadge status={selected.status} />
          <Button variant="outline" size="sm" onClick={() => setManaging(false)}>
            ← Back to workspace
          </Button>
        </ModuleHeader>
        <Tabs defaultValue="plan" className="gap-4">
          <TabsList>
            <TabsTrigger value="plan" className="font-mono text-caption">
              <Target className="mr-1.5 size-3.5" /> Plan
            </TabsTrigger>
            <TabsTrigger value="pages" className="font-mono text-caption">
              <FileText className="mr-1.5 size-3.5" /> Pages
            </TabsTrigger>
            <TabsTrigger value="site" className="font-mono text-caption">
              <Globe className="mr-1.5 size-3.5" /> Site
            </TabsTrigger>
          </TabsList>
          <TabsContent value="plan">
            <PlanTab build={selected} />
          </TabsContent>
          <TabsContent value="pages">
            <PagesTab build={selected} />
          </TabsContent>
          <TabsContent value="site">
            <SiteTab projectId={selected.projectId} />
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  if (selected) {
    if (selected.kind === "app") {
      return <AppWorkspace
        key={selected._id}
        build={{
          _id: selected._id,
          projectId: selected.projectId,
          name: selected.name,
          idea: selected.idea,
          appRequirements: selected.appRequirements,
        }}
        onBack={() => setSelectedId(null)}
      />;
    }
    // Lovable/Caffeine-style workspace: chat left, live preview right.
    return (
      <BuildWorkspace
        build={{
          _id: selected._id,
          name: selected.name,
          status: selected.status,
          idea: selected.idea,
        }}
        onBack={() => setSelectedId(null)}
        onManage={() => setManaging(true)}
      />
    );
  }

  return (
    <div>
      <ModuleHeader
        icon={Blocks}
        title="Build"
        subtitle="Strategy-first websites & apps — planned from your idea, personas and journeys before a single line is generated"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New build
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">New build</DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Websites receive a strategy plan. Apps open a separate requirements workspace with an explicit audience choice; app execution and deployment are not available yet.
              </DialogDescription>
            </DialogHeader>
            <NewBuildForm projectId={projectId} onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </ModuleHeader>

      <ConfirmDelete
        what={pendingDelete ? `"${pendingDelete.name}"` : ""}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await remove({ id: pendingDelete._id });
          toast.success("Build deleted");
        }}
        trigger={
          <span className="hidden" aria-hidden />
        }
      />

      {builds.length === 0 ? (
        <ModuleEmpty
          icon={Blocks}
          title="No builds yet"
          hint="Unlike prompt-to-app tools, every build here starts with a strategy: the idea, the personas it serves, the journeys it answers — then pages, content and SEO/WCAG checks."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Start a build
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {builds.map((b) => (
            <div
              key={b._id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card transition-colors ease-terminal hover:bg-accent",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 cursor-pointer text-left"
                onClick={() => setSelectedId(b._id)}
              >
                <p className="font-mono text-small font-medium">
                  {b.name}{" "}
                  <span className="text-muted-foreground">· {b.kind}</span>
                </p>
                {b.positioning ? (
                  <p className="truncate font-mono text-caption text-muted-foreground">
                    {b.positioning}
                  </p>
                ) : (
                  <p className="font-mono text-caption text-muted-foreground">
                    created {new Date(b.createdAt).toLocaleDateString()}
                  </p>
                )}
              </button>
              <Badge
                variant="outline"
                className="font-mono text-caption text-muted-foreground"
              >
                {/* BP-03: server no longer records seoReady/wcagReady client
                    claims; show a neutral legacy label instead of a fake ok. */}
                {b.seoReady === true
                  ? "seo: legacy ok — verify"
                  : "seo: —"} · {" "}
                {b.wcagReady === true ? "wcag: legacy ok — verify" : "wcag: —"}
              </Badge>
              <StatusBadge status={b.status} />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Delete ${b.name}`}
                className="cursor-pointer text-destructive"
                onClick={() => setPendingDelete(b as BuildRow)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
