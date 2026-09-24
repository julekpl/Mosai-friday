import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ExternalLink,
  Eye,
  Globe,
  History,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  Rocket,
  Send,
  Settings2,
  Sparkles,
  Undo2,
} from "lucide-react";

import { PageRenderer } from "@/components/cms/PageRenderer";
import { ReceiptBadge } from "@/components/app/ReceiptBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/* ── Lovable/Caffeine-style chat + live preview workspace ─────────────────
 *
 * Left: mode-aware chat (Plan shapes strategy, Build edits the real site).
 * Right: live draft preview rendered by the same PageRenderer the public
 * runtime uses. Every build request snapshots a version first. AI never
 * publishes — publish is an explicit user action that walks the canonical
 * revision path (draft → published, prior superseded).
 */

type ChatRow = Doc<"buildMessages">;
type VersionRow = Doc<"buildVersions">;

type PreviewData = {
  site: { _id: Id<"sites">; name: string; status: string } | null;
  pages: {
    _id: Id<"cmsPages">;
    title: string;
    fullPath: string;
    status: string;
    doc: { schemaVersion: number; blocks: never[] };
  }[];
  release: {
    releaseState: "none" | "prepared" | "failed" | "verified";
    lastReleaseAt: number | null;
    seoReady: boolean | null;
    wcagReady: boolean | null;
  };
} | null;

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/* ── Idea screen (first-run, Lovable-style prompt) ──────────────────────── */

export function BuildIdeaScreen({
  buildId,
  idea,
  onDone,
}: {
  buildId: Id<"builds">;
  idea?: string;
  onDone: () => void;
}) {
  const generate = useAction(api.buildChat.generateSite);
  const [text, setText] = useState(idea ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const res = await generate({ buildId, message: text.trim() });
      toast.success(`Built ${res.written.length} pages`, {
        description: "The preview is updated — refine it in chat.",
      });
      onDone();
    } catch (e) {
      toast.error("Generation failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-2xl text-center">
        <p className="font-mono text-caption tracking-widest text-terminal-green uppercase">
          describe it · watch it build
        </p>
        <h1 className="mt-3 font-mono text-h1 font-semibold tracking-tight">
          What should this website be?
        </h1>
        <p className="mx-auto mt-2 max-w-md font-mono text-caption text-muted-foreground">
          One sentence is enough. MOSAI plans the pages, writes the copy and
          renders a live preview — grounded in your project, not templates.
        </p>
        <div className="mt-6 rounded-lg border bg-card p-2 shadow-card">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
            }}
            disabled={busy}
            rows={3}
            autoFocus
            className="resize-none border-0 bg-transparent font-mono text-small shadow-none focus-visible:ring-0"
            placeholder="A storefront for a small-batch coffee roaster — homepage, shop, story and wholesale page. Warm, minimal, product-forward."
          />
          <div className="flex items-center justify-between px-1">
            <p className="font-mono text-caption text-muted-foreground">
              ⌘↵ to build
            </p>
            <Button onClick={() => void submit()} disabled={busy || !text.trim()}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {busy ? "Building…" : "Build it"}
            </Button>
          </div>
        </div>
        <p className="mt-4 font-mono text-caption text-muted-foreground">
          Plan mode first? Say so in chat — shape pages before anything renders.
        </p>
      </div>
    </div>
  );
}

/* ── Chat panel (left) ──────────────────────────────────────────────────── */

function ChatPanel({
  buildId,
  mode,
  activePagePath,
  onModeChange,
  onSiteGenerated,
}: {
  buildId: Id<"builds">;
  mode: "plan" | "build";
  /** The page shown in the preview; Build-mode edits target it. */
  activePagePath: string | null;
  onModeChange: (m: "plan" | "build") => void;
  onSiteGenerated: () => void;
}) {
  const messages = (useQuery(api.buildWorkspace.listMessages, { buildId }) ??
    []) as ChatRow[];
  const plan = useAction(api.buildChat.planSite);
  const edit = useAction(api.buildChat.editPage);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, busy]);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setText("");
    setBusy(true);
    try {
      if (mode === "plan") {
        await plan({ buildId, message });
      } else {
        // Edit the page the user is looking at, never a silent homepage
        // fallback; the server checks the path belongs to this build's site.
        await edit({
          buildId,
          message,
          ...(activePagePath ? { pagePath: activePagePath } : {}),
        });
        onSiteGenerated();
      }
    } catch (e) {
      toast.error(mode === "plan" ? "Plan failed" : "Edit failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* mode switch */}
      <div className="flex items-center gap-1 border-b px-3 py-2">
        {(["plan", "build"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={cn(
              "cursor-pointer rounded-md px-2.5 py-1 font-mono text-caption transition-colors ease-terminal",
              mode === m
                ? "bg-terminal-green-soft text-terminal-green"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {m === "plan" ? "Plan" : "Build"}
          </button>
        ))}
        <p className="ml-auto font-mono text-caption text-muted-foreground">
          {mode === "plan"
            ? "shape strategy — nothing renders yet"
            : "edits apply to the draft"}
        </p>
      </div>

      {/* messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="rounded-md border border-dashed p-4 text-center">
            <p className="font-mono text-caption text-muted-foreground">
              {mode === "plan"
                ? "Describe the business and audience. I'll propose pages and goals — nothing is generated until you switch to Build."
                : "Tell me what to change. Every edit snapshots a version you can roll back to."}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m._id} className="space-y-1.5">
            <div
              className={cn(
                "rounded-md px-3 py-2 font-mono text-caption",
                m.role === "user"
                  ? "ml-6 bg-terminal-blue-soft text-foreground"
                  : "mr-2 border bg-card text-foreground",
              )}
            >
              <p className="mb-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                {m.role === "user" ? "you" : "mosai"} · {m.mode ?? "build"}
              </p>
              {m.content}
            </div>
            {m.suggestions && m.suggestions.length > 0 && (
              <div className="mr-2 space-y-1">
                {m.suggestions.map((s, i) => (
                  <div
                    key={i}
                    className="flex cursor-default items-start gap-2 rounded-md border bg-card px-2.5 py-1.5 font-mono text-caption"
                  >
                    <Check className="mt-0.5 size-3 shrink-0 text-terminal-green" />
                    <span>
                      <span className="font-medium">{s.name}</span>
                      {s.goal && (
                        <span className="block text-muted-foreground">
                          {s.goal}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {m.changedPaths && m.changedPaths.length > 0 && (
              <div className="mr-2 flex flex-wrap gap-1">
                {m.changedPaths.map((p) => (
                  <Badge
                    key={p}
                    variant="outline"
                    className="font-mono text-[10px] text-terminal-green"
                  >
                    {p}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="mr-2 flex items-center gap-2 rounded-md border bg-card px-3 py-2 font-mono text-caption text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {mode === "plan" ? "thinking through the plan…" : "editing the draft…"}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="border-t p-3">
        {mode === "build" && activePagePath && (
          <p
            className="mb-1.5 font-mono text-caption text-muted-foreground"
            aria-live="polite"
          >
            Editing: <span className="text-foreground">{activePagePath}</span>
          </p>
        )}
        <div className="rounded-md border bg-card p-1.5">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={busy}
            rows={2}
            className="resize-none border-0 bg-transparent font-mono text-caption shadow-none focus-visible:ring-0"
            placeholder={
              mode === "plan"
                ? "It's a specialty coffee roaster selling subscriptions…"
                : "Make the hero punchier and add a FAQ section…"
            }
          />
          <div className="flex items-center justify-between px-0.5">
            <p className="font-mono text-[10px] text-muted-foreground">
              ↵ send · ⇧↵ newline
            </p>
            <Button
              size="sm"
              variant={mode === "build" ? "default" : "outline"}
              onClick={() => void send()}
              disabled={busy || !text.trim()}
            >
              <Send className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Versions dropdown ──────────────────────────────────────────────────── */

function VersionsMenu({
  buildId,
  onRestored,
}: {
  buildId: Id<"builds">;
  onRestored: () => void;
}) {
  const versions = (useQuery(api.buildWorkspace.listVersions, { buildId }) ??
    []) as VersionRow[];
  const restore = useMutation(api.buildWorkspace.restoreVersion);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<Id<"buildVersions"> | null>(null);

  // The backdrop below closes the menu on pointer click; keyboard users close
  // it with Escape, so the click target never needs to be focusable itself.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((o) => !o)}
        disabled={versions.length === 0}
      >
        <History className="size-3.5" />
        {versions.length > 0 ? `v${versions[0].version}` : "v0"}
      </Button>
      {open && (
        <>
          {/* Decorative, pointer-only click-away layer: `aria-hidden` keeps it
              out of the accessibility tree, and Escape closes it for keyboard
              users (see the effect above). */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border bg-popover p-1 shadow-card">
            <p className="px-2 py-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
              version history
            </p>
            {versions.map((v) => (
              <button
                key={v._id}
                type="button"
                disabled={busyId !== null}
                onClick={async () => {
                  setBusyId(v._id);
                  try {
                    const n = await restore({ versionId: v._id });
                    toast.success(`Restored v${v.version}`, {
                      description: `${n} page${n === 1 ? "" : "s"} copied back into drafts.`,
                    });
                    setOpen(false);
                    onRestored();
                  } catch (e) {
                    toast.error("Restore failed", {
                      description: e instanceof Error ? e.message : "Try again.",
                    });
                  } finally {
                    setBusyId(null);
                  }
                }}
                className="flex w-full cursor-pointer items-start gap-2 rounded-sm px-2 py-1.5 text-left transition-colors ease-terminal hover:bg-accent"
              >
                <Undo2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-mono text-caption font-medium">
                    v{v.version}
                    {v.isPublished && (
                      <span className="ml-1.5 text-terminal-green">
                        · live
                      </span>
                    )}
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {timeAgo(v.createdAt)}
                    </span>
                  </span>
                  <span className="block truncate font-mono text-caption text-muted-foreground">
                    {v.label}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ── The full workspace ─────────────────────────────────────────────────── */

export function BuildWorkspace({
  build,
  onBack,
  onManage,
}: {
  build: {
    _id: Id<"builds">;
    name: string;
    status: string;
    idea?: string;
    seoReady?: boolean | null;
    wcagReady?: boolean | null;
  };
  onBack: () => void;
  onManage?: () => void;
}) {
  const preview = (useQuery(api.buildWorkspace.getPreviewData, {
    buildId: build._id,
  }) ?? null) as PreviewData;
  const publish = useMutation(api.buildWorkspace.publishSite);
  const [mode, setMode] = useState<"plan" | "build">(
    build.status === "draft" ? "plan" : "build",
  );
  const [activePath, setActivePath] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(true);
  const [publishing, setPublishing] = useState(false);

  const pages = preview?.pages ?? [];
  const activePage =
    pages.find((p) => p.fullPath === (activePath ?? "/")) ?? pages[0] ?? null;
  const hasSite = preview?.site !== null && pages.length > 0;
  const publishable =
    pages.filter((p) => p.doc?.blocks && p.doc.blocks.length > 0).length;

  const doPublish = async () => {
    setPublishing(true);
    try {
      const res = await publish({ buildId: build._id });
      // Honest wording (BP-03): this prepared a release — it did not
      // publish anything. A public URL arrives only with a verified
      // deployment (BP-13).
      toast.success(
        `Release prepared — ${res.prepared} page${res.prepared === 1 ? "" : "s"} approved`,
        {
          description:
            "Saved as a prepared release — not live yet. Deployment to a public URL arrives with hosting setup.",
        },
      );
    } catch (e) {
      toast.error("Release preparation failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setPublishing(false);
    }
  };

  /* Loading */
  if (preview === null) {
    return (
      <div className="flex h-[calc(100vh-220px)] items-center justify-center rounded-lg border bg-card">
        <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> loading workspace…
        </p>
      </div>
    );
  }

  /* No site yet → idea screen */
  if (!hasSite) {
    return (
      <BuildIdeaScreen
        buildId={build._id}
        idea={build.idea}
        onDone={() => setMode("build")}
      />
    );
  }

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[520px] overflow-hidden rounded-lg border bg-card shadow-card">
      {/* left: chat */}
      {showChat && (
        <div className="flex w-[380px] shrink-0 flex-col border-r">
          <ChatPanel
            buildId={build._id}
            mode={mode}
            activePagePath={activePage?.fullPath ?? null}
            onModeChange={setMode}
            onSiteGenerated={() => undefined}
          />
        </div>
      )}

      {/* right: preview */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* preview toolbar */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="Back to builds">
            <ChevronLeft className="size-4" />
          </Button>
          <p className="truncate font-mono text-caption font-medium">
            {build.name}
          </p>
          {preview.release.releaseState === "verified" ? (
            /* BP-03: no deployment receipt can exist until BP-13, so a
             * legacy "verified" value is shown honestly as unverified —
             * never as a green badge without a real receipt. */
            <ReceiptBadge label="requires_verification" detail="no receipt on record" />
          ) : preview.release.releaseState === "prepared" ? (
            <Badge
              variant="outline"
              className="font-mono text-[10px] text-amber-600 dark:text-amber-400"
            >
              <Globe className="mr-1 size-3" /> release prepared — not yet live
            </Badge>
          ) : preview.release.releaseState === "failed" ? (
            <ReceiptBadge
              label="deployment_missing"
              detail="last confirmed release intact"
            />
          ) : (
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              draft
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <VersionsMenu buildId={build._id} onRestored={() => undefined} />
            {onManage && (
              <Button
                size="sm"
                variant="outline"
                onClick={onManage}
                aria-label="Manage site"
              >
                <Settings2 className="size-3.5" />
                <span className="hidden lg:inline">Manage</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowChat((s) => !s)}
              aria-label="Toggle chat"
            >
              {showChat ? (
                <PanelRightClose className="size-3.5" />
              ) : (
                <PanelRightOpen className="size-3.5" />
              )}
            </Button>
            <Button size="sm" onClick={() => void doPublish()} disabled={publishing || publishable === 0}>
              {publishing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Rocket className="size-3.5" />
              )}
              Publish
            </Button>
          </div>
        </div>

        {/* page tabs */}
        <div className="flex items-center gap-1 overflow-x-auto border-b px-3 py-1.5">
          <TooltipProvider delayDuration={200}>
            {pages.map((p) => (
              <Tooltip key={p._id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setActivePath(p.fullPath)}
                    className={cn(
                      "cursor-pointer rounded px-2 py-0.5 font-mono text-caption whitespace-nowrap transition-colors ease-terminal",
                      activePage?._id === p._id
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-accent/60",
                    )}
                  >
                    {p.fullPath === "/" ? "home" : p.fullPath.replace(/^\//, "")}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="font-mono text-[10px]">
                  {p.title} · {p.status}
                </TooltipContent>
              </Tooltip>
            ))}
          </TooltipProvider>
          <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
            <Eye className="size-3" /> live draft preview
          </span>
        </div>

        {/* preview body */}
        <div className="flex-1 overflow-y-auto bg-muted/40 p-4">
          {activePage && activePage.doc?.blocks?.length > 0 ? (
            <div className="mx-auto max-w-4xl rounded-lg border bg-background shadow-card">
              <PageRenderer doc={activePage.doc} />
            </div>
          ) : (
            <div className="mx-auto flex h-full max-w-md items-center justify-center text-center">
              <div>
                <p className="font-mono text-caption text-muted-foreground">
                  {activePage
                    ? `"${activePage.title}" is empty. Ask the chat to write it.`
                    : "No pages yet."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* footer strip */}
        <div className="flex items-center gap-3 border-t px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
          <span>{pages.length} pages</span>
          <span>·</span>
          <span>{publishable} with content</span>
          <span className="ml-auto flex items-center gap-1">
            publish approves content for release — live when hosting is set up
            <ExternalLink className="size-3" />
          </span>
        </div>
      </div>
    </div>
  );
}
