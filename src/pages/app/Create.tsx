import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ResearchSource } from "@/convex/research";
import { toast } from "sonner";
import * as Y from "yjs";
import {
  AlertTriangle,
  Crosshair,
  FileText,
  Loader2,
  PenTool,
  Plus,
  Search,
  Send,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import { ConfirmDelete, ModuleEmpty, StatusBadge } from "@/components/app/module-kit";
import { ContentEditor } from "@/components/app/ContentEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const CONTENT_TYPES = [
  { id: "landing_page", label: "Landing page" },
  { id: "blog", label: "Blog article" },
  { id: "social_post", label: "Social post" },
  { id: "social_series", label: "Social series" },
  { id: "script", label: "Script" },
  { id: "video_script", label: "Video script" },
  { id: "email", label: "Email" },
] as const;

const SOURCE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  wikipedia: "Wikipedia",
  wikibooks: "Wikibooks",
  gdlt: "GDELT",
  youtube: "YouTube",
  newsapi: "NewsAPI",
  trends: "G. Trends",
  local_news: "Local news",
  serp_news: "Serp news",
  google_books: "G. Books",
};

type Hit = { source: string; title: string; url?: string; snippet?: string };

type TopicRow = {
  _id: Id<"contentTopics">;
  projectId: Id<"projects">;
  gapId?: Id<"contentGaps">;
  title: string;
  angle?: string;
  contentType?: string;
  keywords?: string[];
  research?: Hit[];
  researchedAt?: number;
  status?: string;
};

function summarizeSourceStatus(sources: ResearchSource[]): string {
  const counts = sources.reduce<Record<ResearchSource["status"], number>>(
    (result, source) => {
      result[source.status] += 1;
      return result;
    },
    { ok: 0, empty: 0, needs_setup: 0, rate_limited: 0, failed: 0 },
  );
  return [
    counts.ok ? `${counts.ok} returned findings` : null,
    counts.empty ? `${counts.empty} with no matches` : null,
    counts.needs_setup ? `${counts.needs_setup} need setup` : null,
    counts.rate_limited ? `${counts.rate_limited} rate limited` : null,
    counts.failed ? `${counts.failed} unavailable` : null,
  ].filter(Boolean).join(" · ");
}

/* ══ Flow: tabs — Gaps · Topics · Content ═══════════════════════════════ */

export default function Create({ projectId }: { projectId: Id<"projects"> }) {
  const [tab, setTab] = useState("gaps");

  return (
    <div>
      <ModuleHeader
        icon={PenTool}
        title="Create"
        subtitle="Map content gaps per persona × journey stage → research topics → write with AI in a collaborative editor"
      />
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="gaps" className="font-mono text-caption">
            <Crosshair className="mr-1.5 size-3.5" /> Gaps
          </TabsTrigger>
          <TabsTrigger value="topics" className="font-mono text-caption">
            <Search className="mr-1.5 size-3.5" /> Topics &amp; research
          </TabsTrigger>
          <TabsTrigger value="content" className="font-mono text-caption">
            <FileText className="mr-1.5 size-3.5" /> Content
          </TabsTrigger>
        </TabsList>

        <TabsContent value="gaps">
          <GapsTab projectId={projectId} onNext={() => setTab("topics")} />
        </TabsContent>
        <TabsContent value="topics">
          <TopicsTab projectId={projectId} onNext={() => setTab("content")} />
        </TabsContent>
        <TabsContent value="content">
          <ContentTab projectId={projectId} onNext={() => setTab("topics")} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ══ Tab 1: Content gap analysis ════════════════════════════════════════ */

function GapsTab({
  projectId,
  onNext,
}: {
  projectId: Id<"projects">;
  onNext: () => void;
}) {
  const gaps = (useQuery(api.contentPlanning.listGaps, { projectId }) ?? []) as Array<{
    _id: Id<"contentGaps">;
    personaId?: Id<"personas">;
    journeyMapId?: Id<"journeyMaps">;
    journeyStage?: string;
    title: string;
    description?: string;
    severity?: string;
    status?: string;
    source?: string;
  }>;
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const journeys = useQuery(api.journeys.list, { projectId }) ?? [];
  const detect = useAction(api.ai.detectContentGaps);
  const createGap = useMutation(api.contentPlanning.createGap);
  const removeGap = useMutation(api.contentPlanning.removeGap);
  const updateGap = useMutation(api.contentPlanning.updateGap);

  const [busy, setBusy] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [mTitle, setMTitle] = useState("");
  const [mDesc, setMDesc] = useState("");
  const [mPersona, setMPersona] = useState("none");
  const [mJourney, setMJourney] = useState("none");
  const [mStage, setMStage] = useState("none");

  const selectedJourney = journeys.find((j) => j._id === mJourney);

  const runDetect = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await detect({ projectId });
      for (const g of result.gaps) {
        await createGap({
          projectId,
          personaId: g.personaId,
          journeyMapId: g.journeyMapId,
          journeyStage: g.journeyStage,
          title: g.title,
          description: g.description,
          severity: g.severity as "low" | "medium" | "high" | undefined,
          source: "ai",
        });
      }
      toast.success(`${result.gaps.length} content gaps mapped`, {
        description: "Review them below — AI marked the weakest journey stages first.",
      });
    } catch (e) {
      toast.error("Gap analysis failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const addManual = async () => {
    if (!mTitle.trim()) return;
    try {
      await createGap({
        projectId,
        title: mTitle.trim(),
        description: mDesc.trim() || undefined,
        personaId: (mPersona !== "none" ? mPersona : undefined) as
          | Id<"personas">
          | undefined,
        journeyMapId: (mJourney !== "none" ? mJourney : undefined) as
          | Id<"journeyMaps">
          | undefined,
        journeyStage: mStage !== "none" ? mStage : undefined,
        source: "manual",
      });
      toast.success("Gap added");
      setMTitle("");
      setMDesc("");
      setManualOpen(false);
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  const SEVERITY_TONE: Record<string, string> = {
    high: "text-terminal-red border-terminal-red/40 bg-terminal-red-soft",
    medium: "text-terminal-amber border-terminal-amber/40 bg-terminal-amber-soft",
    low: "text-muted-foreground",
  };

  const openGaps = gaps.filter((g) => g.status !== "dismissed");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={runDetect} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Analyzing…
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> Detect gaps with AI
            </>
          )}
        </Button>
        <Button variant="outline" onClick={() => setManualOpen(true)}>
          <Plus className="size-4" /> Add gap manually
        </Button>
        <span className="font-mono text-caption text-muted-foreground">
          needs personas &amp; journey maps (from Understand / Journeys)
        </span>
      </div>

      {openGaps.length === 0 ? (
        <ModuleEmpty
          icon={AlertTriangle}
          title="No content gaps mapped yet"
          hint="AI cross-checks personas + journey stages against the business and flags where content is missing. Or add your own."
          action={
            <Button onClick={runDetect} disabled={busy}>
              <Sparkles className="size-4" /> Detect gaps with AI
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {openGaps.map((g) => {
            const persona = personas.find((p) => p._id === g.personaId);
            const journey = journeys.find((j) => j._id === g.journeyMapId);
            return (
              <div key={g._id} className="rounded-md border bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-small font-medium">{g.title}</p>
                      {g.severity && (
                        <Badge
                          variant="outline"
                          className={cn("font-mono text-caption", SEVERITY_TONE[g.severity])}
                        >
                          {g.severity}
                        </Badge>
                      )}
                      <Badge variant="outline" className="font-mono text-caption text-muted-foreground">
                        {g.source === "ai" ? "ai" : "manual"}
                      </Badge>
                    </div>
                    {g.description && (
                      <p className="mt-1 font-mono text-caption text-muted-foreground">
                        {g.description}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-caption text-muted-foreground">
                      {persona && <span className="text-terminal-blue">persona: {persona.name}</span>}
                      {journey && <span>journey: {journey.name}</span>}
                      {g.journeyStage && <span>stage: {g.journeyStage}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 font-mono text-caption"
                      onClick={() => {
                        onNext();
                      }}
                    >
                      <Search className="size-3.5" /> Research topics
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Dismiss gap"
                      title="Dismiss"
                      onClick={async () => {
                        await updateGap({ id: g._id, status: "dismissed" });
                        toast.success("Gap dismissed");
                      }}
                    >
                      ×
                    </Button>
                    <ConfirmDelete
                      what={`"${g.title}"`}
                      onConfirm={async () => {
                        await removeGap({ id: g._id });
                        toast.success("Gap deleted");
                      }}
                      trigger={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${g.title}`}
                          className="text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Manual gap dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">Add content gap</DialogTitle>
            <DialogDescription className="font-mono text-caption">
              A question, topic or moment where content is missing for a persona.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="gap-title">Title</Label>
              <Input
                id="gap-title"
                value={mTitle}
                onChange={(e) => setMTitle(e.target.value)}
                placeholder="e.g. No content answering “will it work with our CRM?”"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gap-desc">Why it matters (optional)</Label>
              <Textarea
                id="gap-desc"
                value={mDesc}
                onChange={(e) => setMDesc(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label>Persona</Label>
                <Select value={mPersona} onValueChange={setMPersona}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— none —</SelectItem>
                    {personas.map((p) => (
                      <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Journey</Label>
                <Select
                  value={mJourney}
                  onValueChange={(v) => {
                    setMJourney(v);
                    setMStage("none");
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— none —</SelectItem>
                    {journeys.map((j) => (
                      <SelectItem key={j._id} value={j._id}>{j.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Stage</Label>
                <Select value={mStage} onValueChange={setMStage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— none —</SelectItem>
                    {(selectedJourney?.stages ?? []).map((s, i) => (
                      <SelectItem key={i} value={s.stage}>{s.stage}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setManualOpen(false)}>Cancel</Button>
              <Button onClick={addManual} disabled={!mTitle.trim()}>Add gap</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ══ Tab 2: Topics & research ═══════════════════════════════════════════ */

function TopicsTab({
  projectId,
  onNext,
}: {
  projectId: Id<"projects">;
  onNext: () => void;
}) {
  const gaps = useQuery(api.contentPlanning.listGaps, { projectId }) ?? [];
  const topicsRaw = useQuery(api.contentPlanning.listTopics, { projectId });
  const topics = useMemo(
    () => (topicsRaw ?? []) as TopicRow[],
    [topicsRaw],
  );
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const suggest = useAction(api.ai.suggestTopics);
  const research = useAction(api.research.researchTopic);
  const createTopic = useMutation(api.contentPlanning.createTopic);
  const updateTopic = useMutation(api.contentPlanning.updateTopic);
  const removeTopic = useMutation(api.contentPlanning.removeTopic);

  const [gapId, setGapId] = useState("none");
  const [busy, setBusy] = useState(false);
  const [researching, setResearching] = useState<string | null>(null);
  const [sourceStatusByTopic, setSourceStatusByTopic] = useState<Record<string, ResearchSource[]>>({});
  const [researchOpen, setResearchOpen] = useState<string | null>(null);
  const [manualTopic, setManualTopic] = useState("");
  const [manualType, setManualType] = useState("blog");

  const gap = gaps.find((g) => g._id === gapId);
  const openGaps = gaps.filter((g) => g.status !== "dismissed");

  const topicsForGap = useMemo(
    () => (gapId === "none" ? topics : topics.filter((t) => t.gapId === gapId)),
    [topics, gapId],
  );

  const personaOf = (t: TopicRow) => {
    const g = gaps.find((gg) => gg._id === t.gapId);
    return personas.find((p) => p._id === g?.personaId);
  };

  const runSuggest = async () => {
    if (!gap || busy) return;
    setBusy(true);
    try {
      // 1. quick live research on the gap title to ground topic suggestions
      let digest: string[] = [];
      try {
        const result = await research({ query: gap.title });
        digest = result.hits.slice(0, 12).map((h) => `- [${h.source}] ${h.title}`);
      } catch {
        /* research optional here */
      }
      const result = await suggest({
        projectId,
        gap: {
          title: gap.title,
          description: gap.description,
          personaName: personas.find((p) => p._id === gap.personaId)?.name,
          journeyStage: gap.journeyStage,
        },
        researchDigest: digest,
      });
      for (const t of result.topics) {
        await createTopic({
          projectId,
          gapId: gap._id,
          title: t.title,
          angle: t.angle,
          contentType: t.contentType,
          keywords: t.keywords,
        });
      }
      toast.success(`${result.topics.length} topics suggested`, {
        description: "Research any topic, then turn it into content.",
      });
    } catch (e) {
      toast.error("Suggestion failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const runResearch = async (t: TopicRow, researchedAt: number) => {
    if (researching) return;
    setResearching(t._id);
    try {
      const result = await research({
        query: `${t.title}${t.angle ? ` ${t.angle}` : ""}`,
        personaContext: personaOf(t)?.name,
      });
      const hits = result.hits;
      setSourceStatusByTopic((current) => ({ ...current, [t._id]: result.sources }));
      const incompleteSources = result.sources.filter((source) =>
        source.status === "needs_setup" || source.status === "rate_limited" || source.status === "failed",
      );
      if (hits.length === 0 && incompleteSources.length > 0) {
        toast.warning("Research could not complete", {
          description: "No findings were saved because one or more sources need setup or could not be reached. Open source details, then try again.",
        });
        return;
      }
      await updateTopic({
        id: t._id,
        research: hits,
        researchedAt,
        status: "researched",
      });
      if (hits.length === 0) {
        toast.message("No findings", {
          description: "Available sources completed successfully but returned no matches.",
        });
      } else {
        toast.success(`${hits.length} findings from ${new Set(hits.map((h) => h.source)).size} sources`);
      }
    } catch (e) {
      toast.error("Research failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setResearching(null);
    }
  };

  const addManual = async () => {
    if (!manualTopic.trim()) return;
    await createTopic({
      projectId,
      gapId: gapId !== "none" ? (gapId as Id<"contentGaps">) : undefined,
      title: manualTopic.trim(),
      contentType: manualType,
    });
    setManualTopic("");
    toast.success("Topic added");
  };

  const makeContent = async (t: TopicRow) => {
    try {
      await createPiece({
        projectId,
        topicId: t._id as never,
        gapId: t.gapId as never,
        title: t.title,
        topic: t.title,
        brief: [t.angle, ...(t.keywords ?? [])].filter(Boolean).join(" · "),
        contentType: t.contentType ?? "blog",
        personaId: personaOf(t)?._id,
        journeyMapId: gaps.find((g) => g._id === t.gapId)?.journeyMapId,
        journeyStage: gaps.find((g) => g._id === t.gapId)?.journeyStage,
      });
      toast.success("Content piece created — open it in the Content tab", {
        description: "The editor can AI-draft from the topic + research.",
      });
      onNext();
    } catch (e) {
      toast.error("Create failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  const createPiece = useMutation(api.content.create);

  return (
    <div className="grid gap-4">
      {/* gap picker + AI suggest */}
      <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
        <div className="min-w-52 flex-1">
          <Label className="font-mono text-caption text-muted-foreground">
            fill a gap
          </Label>
          <Select value={gapId} onValueChange={setGapId}>
            <SelectTrigger className="mt-1 w-full">
              <SelectValue placeholder="Pick a gap" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">All topics</SelectItem>
              {openGaps.map((g) => (
                <SelectItem key={g._id} value={g._id}>{g.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={runSuggest} disabled={busy || !gap}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Working…
            </>
          ) : (
            <>
              <Sparkles className="size-4" /> AI topic research
            </>
          )}
        </Button>
      </div>

      {/* manual topic */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1">
          <Input
            value={manualTopic}
            onChange={(e) => setManualTopic(e.target.value)}
            placeholder="Or add a topic manually…"
            onKeyDown={(e) => e.key === "Enter" && void addManual()}
          />
        </div>
        <Select value={manualType} onValueChange={setManualType}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONTENT_TYPES.map((ct) => (
              <SelectItem key={ct.id} value={ct.id}>{ct.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={addManual} disabled={!manualTopic.trim()}>
          <Plus className="size-4" /> Add
        </Button>
      </div>

      {topicsForGap.length === 0 ? (
        <ModuleEmpty
          icon={Search}
          title="No topics yet"
          hint="Pick a gap and run AI topic research — or add topics manually. Each topic can be researched across 10 sources."
        />
      ) : (
        <div className="grid gap-3">
          {topicsForGap.map((t) => {
            const persona = personaOf(t);
            return (
              <div key={t._id} className="rounded-md border bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-small font-medium">{t.title}</p>
                    {t.angle && (
                      <p className="mt-0.5 font-mono text-caption text-muted-foreground">
                        {t.angle}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="font-mono text-caption">
                        {CONTENT_TYPES.find((c) => c.id === t.contentType)?.label ?? t.contentType ?? "blog"}
                      </Badge>
                      {persona && (
                        <Badge variant="outline" className="font-mono text-caption text-terminal-blue">
                          {persona.name}
                        </Badge>
                      )}
                      {t.keywords?.map((k) => (
                        <Badge key={k} variant="outline" className="font-mono text-caption text-muted-foreground">
                          {k}
                        </Badge>
                      ))}
                    </div>
                    {t.research && t.research.length > 0 && (
                      <p className="mt-2 font-mono text-caption text-muted-foreground">
                        {t.research.length} findings ·{" "}
                        {[...new Set(t.research.map((h) => h.source))]
                          .map((s) => SOURCE_LABELS[s] ?? s)
                          .join(", ")}
                      </p>
                    )}
                    {sourceStatusByTopic[t._id] && (
                      <details className="mt-2 rounded-sm border px-2.5 py-1.5" aria-live="polite">
                        <summary className="cursor-pointer font-mono text-caption text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          Source status: {summarizeSourceStatus(sourceStatusByTopic[t._id])} · show details
                        </summary>
                        <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                          {sourceStatusByTopic[t._id].map((source) => (
                            <li
                              key={source.provider}
                              className="flex min-w-0 flex-wrap items-center gap-1.5 font-mono text-caption"
                              title={`Checked ${new Date(source.retrievedAt).toLocaleString()}`}
                            >
                              <span>{SOURCE_LABELS[source.provider] ?? source.provider}:</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "font-mono text-caption",
                                  source.status === "ok" && "text-terminal-green",
                                  (source.status === "needs_setup" || source.status === "rate_limited" || source.status === "failed") && "text-terminal-amber",
                                )}
                              >
                                {source.status.replace("_", " ")}
                              </Badge>
                              {source.errorCategory && (
                                <span className="text-muted-foreground">({source.errorCategory.replace("_", " ")})</span>
                              )}
                              <time className="text-muted-foreground" dateTime={new Date(source.retrievedAt).toISOString()}>
                                {new Date(source.retrievedAt).toLocaleTimeString()}
                              </time>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 font-mono text-caption"
                      onClick={() => void runResearch(t, Date.now())}
                      disabled={researching !== null}
                    >
                      {researching === t._id ? (
                        <>
                          <Loader2 className="size-3.5 animate-spin" /> researching…
                        </>
                      ) : (
                        <>
                          <Search className="size-3.5" /> Research
                        </>
                      )}
                    </Button>
                    {t.research && t.research.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 font-mono text-caption"
                        onClick={() =>
                          setResearchOpen(researchOpen === t._id ? null : t._id)
                        }
                      >
                        findings
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="h-7 font-mono text-caption"
                      onClick={() => void makeContent(t)}
                    >
                      <Wand2 className="size-3.5" /> Create content
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${t.title}`}
                      className="text-destructive"
                      onClick={async () => {
                        await removeTopic({ id: t._id });
                        toast.success("Topic deleted");
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {/* research findings */}
                {researchOpen === t._id && t.research && (
                  <div className="mt-3 grid gap-1.5 border-t pt-3">
                    {t.research.map((h, i) => (
                      <a
                        key={i}
                        href={h.url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-sm border px-2.5 py-1.5 ease-terminal hover:border-terminal-green/50 hover:bg-terminal-green-soft"
                      >
                        <span className="font-mono text-caption text-terminal-green">
                          [{SOURCE_LABELS[h.source] ?? h.source}]
                        </span>{" "}
                        <span className="font-mono text-caption">{h.title}</span>
                        {h.snippet && (
                          <span className="block truncate font-mono text-caption text-muted-foreground">
                            {h.snippet}
                          </span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══ Tab 3: Content pieces + editor ═════════════════════════════════════ */

function ContentTab({ projectId, onNext }: { projectId: Id<"projects">; onNext: () => void }) {
  const pieces = useQuery(api.content.list, { projectId }) ?? [];
  const remove = useMutation(api.content.remove);
  const update = useMutation(api.content.update);
  const create = useMutation(api.content.create);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualType, setManualType] = useState("blog");

  const [openPiece, setOpenPiece] = useState<Id<"contentPieces"> | null>(null);
  const piece = pieces.find((p) => p._id === openPiece);

  if (openPiece && piece) {
    return (
      <PieceEditor
        key={piece._id}
        projectId={projectId}
        piece={piece}
        onBack={() => setOpenPiece(null)}
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex justify-end"><Button onClick={() => setManualOpen(true)}><Plus className="size-4" /> Create content manually</Button></div>
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Create content</DialogTitle><DialogDescription>Start with a title. You can write or generate the copy in the editor.</DialogDescription></DialogHeader>
          <div className="grid gap-3"><div className="grid gap-1.5"><Label htmlFor="manual-content-title">Title</Label><Input id="manual-content-title" value={manualTitle} onChange={(e) => setManualTitle(e.target.value)} placeholder="e.g. How to choose…" /></div><div className="grid gap-1.5"><Label>Type</Label><Select value={manualType} onValueChange={setManualType}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{CONTENT_TYPES.map((ct) => <SelectItem key={ct.id} value={ct.id}>{ct.label}</SelectItem>)}</SelectContent></Select></div><div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setManualOpen(false)}>Cancel</Button><Button disabled={!manualTitle.trim()} onClick={async () => { const id = await create({ projectId, title: manualTitle.trim(), topic: manualTitle.trim(), contentType: manualType }); setManualTitle(""); setManualOpen(false); setOpenPiece(id); toast.success("Content created"); }}>Create</Button></div></div>
        </DialogContent>
      </Dialog>
      {pieces.length === 0 ? (
        <ModuleEmpty
          icon={FileText}
          title="No content pieces yet"
          hint="Turn a researched topic into a content piece — the collaborative editor drafts, expands and rewrites with AI."
          action={
            <Button onClick={onNext}>
              <Search className="size-4" /> Start from topics
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {pieces.map((c) => {
            return (
              <div
                key={c._id}
                className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-small font-medium">{c.title}</p>
                  <p className="font-mono text-caption text-muted-foreground">
                    {c.contentType
                      ? `${CONTENT_TYPES.find((ct) => ct.id === c.contentType)?.label ?? c.contentType} · `
                      : ""}
                    {c.topic ? `${c.topic} · ` : ""}
                    updated {new Date(c.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge status={c.status} />
                {c.status === "draft" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 font-mono text-caption"
                    onClick={() => void update({ id: c._id, status: "approved" })}
                  >
                    Approve
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 font-mono text-caption"
                  onClick={() => setOpenPiece(c._id)}
                >
                  <PenTool className="size-3.5" /> Open editor
                </Button>
                <ConfirmDelete
                  what={`"${c.title}"`}
                  onConfirm={async () => {
                    await remove({ id: c._id });
                    toast.success("Content piece deleted");
                  }}
                  trigger={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${c.title}`}
                      className="text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Single piece: Y.Doc lifecycle + AI wiring ────────────────────────── */

type PieceRow = {
  _id: Id<"contentPieces">;
  title: string;
  topicId?: Id<"contentTopics">;
  personaId?: Id<"personas">;
  journeyStage?: string;
  topic?: string;
  body?: string;
  contentType?: string;
  status: "draft" | "approved" | "published";
  updatedAt: number;
};

function PieceEditor({
  projectId,
  piece,
  onBack,
}: {
  projectId: Id<"projects">;
  piece: PieceRow;
  onBack: () => void;
}) {
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const journeys = useQuery(api.journeys.list, { projectId }) ?? [];
  const topics = useQuery(api.contentPlanning.listTopics, { projectId }) ?? [];
  const saveDoc = useMutation(api.contentPlanning.saveDoc);
  const update = useMutation(api.content.update);
  const updateTopic = useMutation(api.contentPlanning.updateTopic);
  const editSelectionAi = useAction(api.ai.editSelection);
  const generateContentAi = useAction(api.ai.generateContent);

  const storedDoc = useQuery(api.contentPlanning.getDoc, { pieceId: piece._id });

  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const initializedRef = useRef(false);

  // Create + hydrate the Y.Doc exactly once per opened piece: apply the
  // stored snapshot when there is one. Seed text (no snapshot) is derived
  // below so the effect never has to set a second piece of state.
  useEffect(() => {
    if (storedDoc === undefined || initializedRef.current) return; // still loading
    initializedRef.current = true;
    const ydoc = new Y.Doc();
    if (storedDoc?.snapshot) {
      Y.applyUpdate(ydoc, new Uint8Array(storedDoc.snapshot));
    }
    setDoc(ydoc);
    return () => {
      initializedRef.current = false;
      ydoc.destroy();
    };
  }, [storedDoc]);

  const initialHtml = storedDoc && !storedDoc.snapshot ? piece.body : undefined;

  const topic = piece.topicId ? topics.find((t) => t._id === piece.topicId) : undefined;
  const persona = personas.find((p) => p._id === piece.personaId);
  const journey = journeys.find((j) => j._id === (piece as { journeyMapId?: Id<"journeyMaps"> }).journeyMapId);

  const researchDigest = (topic?.research ?? [])
    .slice(0, 20)
    .map(
      (h) =>
        `- [${h.source}] ${h.title}${h.snippet ? `: ${h.snippet.slice(0, 120)}` : ""}`,
    );
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const addSource = async () => {
    if (!topic || !sourceTitle.trim()) return;
    await updateTopic({ id: topic._id, research: [...(topic.research ?? []), { source: "user", title: sourceTitle.trim(), url: sourceUrl.trim() || undefined }] });
    setSourceTitle(""); setSourceUrl("");
    toast.success("Source added");
  };

  const runAiEdit = async ({
    op,
    selectionText,
    surroundingText,
  }: {
    op: "expand" | "rewrite";
    selectionText: string;
    surroundingText: string;
  }) => {
    // empty selection + expand = full AI draft
    if (!selectionText.trim() && op === "expand") {
      return await generateContentAi({
        projectId,
        topic: {
          title: topic?.title ?? piece.title,
          angle: topic?.angle,
          contentType: piece.contentType ?? topic?.contentType,
          keywords: topic?.keywords,
        },
        personaId: persona?._id,
        journeyStage: piece.journeyStage ?? journey?.stages.find((s) => s.stage === piece.journeyStage)?.stage,
        researchDigest,
      });
    }
    return await editSelectionAi({
      op,
      selectionHtml: selectionText,
      surroundingContext: surroundingText,
      projectId,
      personaName: persona?.name,
    });
  };

  const pushToPromote = useMutation(api.posts.create);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 font-mono text-caption"
          onClick={onBack}
        >
          ← back to list
        </Button>
        <p className="font-mono text-small font-medium">{piece.title}</p>
        <StatusBadge status={piece.status} />
        <div className="ml-auto flex gap-1">
          {piece.status === "draft" && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 font-mono text-caption"
              onClick={async () => {
                try {
                  await update({ id: piece._id, status: "approved" });
                  toast.success("Approved");
                } catch (e) {
                  toast.error("Approve failed", {
                    description: e instanceof Error ? e.message : "Try again.",
                  });
                }
              }}
            >
              Approve
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 cursor-pointer font-mono text-caption"
            onClick={async () => {
              try {
                await pushToPromote({
                  projectId,
                  contentId: piece._id,
                  body: (piece.body || piece.title).slice(0, 20000),
                  channel: "linkedin",
                });
                toast.success("Pushed to Promote", {
                  description: "A LinkedIn draft is waiting in the Promote social queue — adapt it to other platforms with AI variants there.",
                });
              } catch (e) {
                toast.error("Push failed", {
                  description: e instanceof Error ? e.message : "Try again.",
                });
              }
            }}
          >
            <Send className="size-3.5" /> Push to Promote
          </Button>
        </div>
      </div>

      {doc ? (
        <div className="grid gap-2 rounded-md border bg-card p-3">
          <div className="flex items-center justify-between"><p className="font-mono text-caption font-medium">Sources for this piece</p><span className="font-mono text-caption text-muted-foreground">{topic?.research?.length ?? 0} saved</span></div>
          {topic?.research?.length ? <div className="grid gap-1">{topic.research.map((h, i) => <a key={`${h.title}-${i}`} href={h.url ?? "#"} target="_blank" rel="noreferrer" className="truncate font-mono text-caption text-terminal-blue hover:underline">[{h.source}] {h.title}</a>)}</div> : <p className="font-mono text-caption text-muted-foreground">Research this topic first, or add your own source below.</p>}
          <div className="flex flex-wrap gap-2"><Input value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} placeholder="Source title" className="min-w-48 flex-1" /><Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://… (optional)" className="min-w-48 flex-1" /><Button size="sm" variant="outline" onClick={() => void addSource()} disabled={!sourceTitle.trim()}><Plus className="size-3.5" /> Add source</Button></div>
        </div>
      ) : null}
      {doc ? (
        <ContentEditor
          doc={doc}
          initialHtml={initialHtml}
          ctx={{
            personaName: persona?.name,
            journeyStage: piece.journeyStage ?? undefined,
            topicTitle: topic?.title ?? piece.topic,
          }}
          onSave={async ({ snapshot: snap, bodyHtml }) => {
            await saveDoc({
              pieceId: piece._id,
              snapshot: snap.slice().buffer as ArrayBuffer,
              bodyHtml,
            });
          }}
          onAiEdit={runAiEdit}
        />
      ) : (
        <p className="font-mono text-caption text-muted-foreground">Preparing editor…</p>
      )}
    </div>
  );
}
