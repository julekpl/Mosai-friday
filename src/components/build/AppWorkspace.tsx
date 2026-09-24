import { Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { ArrowLeft, ArrowUp, History, Loader2, Sparkles, Square } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { ModuleHeader } from "@/components/app/AppShell";
import { StatusBadge } from "@/components/app/module-kit";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AppBriefPanel, type AppBuild } from "@/components/build/AppBriefPanel";
import { AppCode } from "@/components/build/app/AppCode";
import { starterSuggestions } from "@/components/build/app/suggestions";
import { APP_SOURCE_LIMITS } from "@/shared/appBuilder/source";

const AppPreview = lazy(() => import("@/components/build/app/AppPreview"));

const RUN_LABEL = {
  queued: "generating",
  running: "generating",
  succeeded: "applied",
  partially_succeeded: "partially_applied",
  failed: "failed",
  canceled: "canceled",
} as const;

/**
 * Build → App: chat on the left, the running app on the right (BP-15,
 * owner decision 24 Sep 2026: chat first, brief optional, open-lovable-style
 * generation, in-browser preview). Every chat turn is a server job; its
 * status comes from the database, never from the browser.
 */
export function AppWorkspace({ build, onBack }: { build: AppBuild; onBack: () => void }) {
  const data = useQuery(api.modules.buildApp.workspace.workspace, { buildId: build._id });
  const personas = useQuery(api.personas.list, { projectId: build.projectId });
  const journeys = useQuery(api.journeys.list, { projectId: build.projectId });
  const send = useMutation(api.modules.buildApp.workspace.sendMessage);
  const cancel = useMutation(api.modules.buildApp.workspace.cancelRun);
  const restore = useMutation(api.modules.buildApp.workspace.restoreVersion);
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState("preview");
  const chatEnd = useRef<HTMLDivElement>(null);

  const runs = data?.runs ?? [];
  const active = runs.find((run) => run.status === "queued" || run.status === "running");
  const lastRunId = runs[runs.length - 1]?._id;
  useEffect(() => {
    chatEnd.current?.scrollIntoView?.({ block: "nearest" });
  }, [runs.length, lastRunId, active?.status]);

  const suggestions = starterSuggestions({
    idea: build.appRequirements?.goal ?? build.idea,
    personas: (personas ?? []).map((persona) => ({ name: persona.name, role: persona.role, goals: persona.goals })),
    journeys: (journeys ?? []).map((journey) => ({ name: journey.name, stages: journey.stages })),
  });

  const submit = async (text = prompt) => {
    const value = text.trim();
    if (!value || sending || active) return;
    setSending(true);
    try {
      await send({ buildId: build._id, prompt: value });
      setPrompt("");
    } catch (error) {
      toast.error("Could not send the request", { description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div>
      <ModuleHeader icon={Sparkles} title={`${build.name} · app`} subtitle="Describe what you want. MOSAI builds it with your personas, journeys and products in mind.">
        <Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="size-4" /> Builds</Button>
      </ModuleHeader>
      <p className="mb-4 rounded-md border bg-card p-3 font-mono text-caption text-muted-foreground">
        The preview runs in your browser on CodeSandbox’s isolated domain. Nothing is published, and the app has no backend or deploy yet.
      </p>

      <div className="grid gap-5 xl:grid-cols-5">
        <section aria-labelledby="app-chat-heading" className="flex min-w-0 flex-col rounded-lg border bg-card xl:col-span-2">
          <h2 id="app-chat-heading" className="border-b px-4 py-3 font-mono text-small font-semibold">Chat</h2>
          <div className="max-h-[60vh] min-h-64 flex-1 overflow-y-auto px-4 py-3" aria-live="polite" aria-busy={Boolean(active)}>
            {data === undefined ? (
              <p role="status" className="font-mono text-caption text-muted-foreground">Loading the app…</p>
            ) : runs.length === 0 ? (
              <div className="grid gap-3">
                <p className="font-mono text-caption text-muted-foreground">Start with what the app should do. Try one of these, built from your project:</p>
                <ul className="grid gap-2">
                  {suggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button type="button" onClick={() => setPrompt(suggestion)} className="w-full rounded-md border p-3 text-left font-mono text-caption hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <ol className="grid gap-4">
                {runs.map((run) => (
                  <li key={run._id} className="grid gap-2">
                    <p className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-md bg-accent px-3 py-2 font-mono text-caption">{run.prompt}</p>
                    <div className="grid max-w-[95%] gap-1.5 rounded-md border px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={RUN_LABEL[run.status]} />
                        {run.snapshotVersion ? <span className="font-mono text-caption text-muted-foreground">version {run.snapshotVersion}</span> : null}
                        {run.status === "queued" || run.status === "running" ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
                      </div>
                      {run.reply ? <p className="whitespace-pre-wrap font-mono text-caption">{run.reply}</p> : null}
                      {run.error ? <p className="font-mono text-caption text-destructive">{run.error}</p> : null}
                      {run.changedPaths.length > 0 ? (
                        <p className="font-mono text-caption text-muted-foreground">Changed: {run.changedPaths.map((path) => path.replace(/^src\//, "")).join(", ")}</p>
                      ) : null}
                      {run.skippedPaths.length > 0 ? (
                        <p className="font-mono text-caption text-terminal-amber">Not written (incomplete or not allowed): {run.skippedPaths.join(", ")}. Ask again to finish them.</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div ref={chatEnd} />
          </div>
          <form
            className="grid gap-2 border-t p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label htmlFor="app-prompt" className="sr-only">Describe what to build or change</label>
            <Textarea
              id="app-prompt"
              rows={3}
              value={prompt}
              maxLength={APP_SOURCE_LIMITS.maxPromptChars}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={runs.length ? "Ask for a change, e.g. make the header dark" : "Describe the app you want"}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-caption text-muted-foreground">Enter to send · Shift+Enter for a new line</p>
              {active ? (
                <Button type="button" variant="outline" size="sm" onClick={() => void cancel({ runId: active._id })}>
                  <Square className="size-4" /> Stop
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={!prompt.trim() || sending}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />} Send
                </Button>
              )}
            </div>
          </form>
        </section>

        <section aria-label="App" className="min-w-0 xl:col-span-3">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="preview">Preview</TabsTrigger>
              <TabsTrigger value="code">Code</TabsTrigger>
              <TabsTrigger value="brief">Brief</TabsTrigger>
              <TabsTrigger value="versions">Versions</TabsTrigger>
            </TabsList>
            <TabsContent value="preview" className="mt-3">
              <div className="h-[70vh] min-h-96 overflow-hidden rounded-md border bg-card">
                {data?.head ? (
                  <Suspense fallback={<p role="status" className="p-4 font-mono text-caption text-muted-foreground">Loading the preview…</p>}>
                    <AppPreview source={{ version: data.head.version, files: data.head.files, dependencies: data.head.dependencies }} />
                  </Suspense>
                ) : (
                  <p className="p-4 font-mono text-caption text-muted-foreground">
                    {data === undefined ? "Loading…" : "Your app appears here after the first message."}
                  </p>
                )}
              </div>
            </TabsContent>
            <TabsContent value="code" className="mt-3">
              {data?.head ? (
                <AppCode key={data.head.version} buildId={build._id} version={data.head.version} files={data.head.files} />
              ) : (
                <p className="font-mono text-caption text-muted-foreground">No code yet. Send a message to generate the app.</p>
              )}
            </TabsContent>
            <TabsContent value="brief" className="mt-3">
              <AppBriefPanel build={build} />
            </TabsContent>
            <TabsContent value="versions" className="mt-3">
              {data && data.versions.length > 0 ? (
                <ol className="grid gap-2">
                  {data.versions.map((snapshot) => (
                    <li key={snapshot.version} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card p-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-caption font-medium">v{snapshot.version} · {snapshot.label}</p>
                        <p className="font-mono text-caption text-muted-foreground">
                          {snapshot.source} · {snapshot.fileCount} files · {new Date(snapshot.createdAt).toLocaleString()}
                        </p>
                      </div>
                      {snapshot.version === data.head?.version ? (
                        <StatusBadge status="current" />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={Boolean(active)}
                          onClick={async () => {
                            try {
                              await restore({ buildId: build._id, version: snapshot.version });
                              toast.success(`Restored version ${snapshot.version}`, { description: "Saved as a new version; history is kept." });
                            } catch (error) {
                              toast.error("Could not restore", { description: error instanceof Error ? error.message : "Try again." });
                            }
                          }}
                        >
                          <History className="size-4" /> Restore
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="font-mono text-caption text-muted-foreground">No versions yet.</p>
              )}
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}
