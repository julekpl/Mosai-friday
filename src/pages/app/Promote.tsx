import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  Link2,
  Loader2,
  Megaphone,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Undo2,
  Unplug,
  XCircle,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import { BrandUseChip } from "@/components/app/brand/BrandUse";
import {
  ConfirmDelete,
  ModuleEmpty,
  StatusBadge,
} from "@/components/app/module-kit";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSocialPostReadiness } from "@/lib/social-post-readiness";

const CAMPAIGN_CHANNELS = ["email", "ads", "social"] as const;
const POST_CHANNELS = ["facebook", "instagram", "linkedin", "x", "tiktok"] as const;

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  tiktok: "TikTok",
};

/* ── Connections strip: real OAuth status, honest about configuration ─── */

function ConnectionsPanel({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const status = useQuery(api.social.oauth.status, { projectId }) ?? [];
  const start = useMutation(api.social.oauth.start);
  const disconnect = useMutation(api.social.oauth.disconnect);

  const connect = async (platform: string) => {
    try {
      const { authorizeUrl } = await start({ projectId, platform });
      window.location.assign(authorizeUrl);
    } catch (e) {
      toast.error(`Could not start ${PLATFORM_LABEL[platform] ?? platform} connection`, {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 shadow-card">
      <span className="mr-1 flex items-center gap-1.5 font-mono text-caption text-muted-foreground">
        <Link2 className="size-3.5" /> publish via
      </span>
      {status.map((s) => (
        <div
          key={s.platform}
          className="flex items-center gap-1.5 rounded-sm border px-2 py-1"
          title={
            s.connected
              ? `Connected${s.accountLabel ? ` as ${s.accountLabel}` : ""}`
              : s.configured
                ? "Available — connect to enable publishing"
                : s.setupDetail ?? "Not configured in this deployment"
          }
        >
          <span
            className={`size-1.5 shrink-0 rounded-full ${
              s.connected
                ? "bg-terminal-green"
                : s.configured
                  ? "bg-terminal-amber"
                  : "bg-muted-foreground/40"
            }`}
          />
          <span
            className={`font-mono text-caption ${
              s.connected ? "" : "text-muted-foreground"
            }`}
          >
            {PLATFORM_LABEL[s.platform] ?? s.platform}
          </span>
          {s.connected ? (
            <button
              className="cursor-pointer text-muted-foreground transition-colors hover:text-terminal-red"
              aria-label={`Disconnect ${s.platform}`}
              onClick={async () => {
                await disconnect({ projectId, platform: s.platform });
                toast.success(`${PLATFORM_LABEL[s.platform] ?? s.platform} disconnected`);
              }}
            >
              <Unplug className="size-3" />
            </button>
          ) : s.configured ? (
            <button
              className="cursor-pointer font-mono text-caption text-terminal-green hover:underline disabled:opacity-40"
              onClick={() => connect(s.platform)}
            >
              connect
            </button>
          ) : (
            <span className="font-mono text-caption text-muted-foreground" role="status">
              setup needed
            </span>
          )}
        </div>
      ))}
      {status.some((s) => !s.configured) && (
        <span className="basis-full text-caption text-muted-foreground">
          An administrator must configure the provider and trusted app return origin before connecting accounts.
        </span>
      )}
    </div>
  );
}

/* ── AI copilot dialog: source → platform drafts (never auto-scheduled) ── */

function AiVariantsDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const campaigns = useQuery(api.campaigns.list, { projectId }) ?? [];
  const draftVariants = useAction(api.social.copilot.draftVariants);

  const [sourceText, setSourceText] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["linkedin", "x"]);
  const [busy, setBusy] = useState(false);

  const togglePlatform = (p: string) =>
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );

  const run = async () => {
    if (!sourceText.trim() || platforms.length === 0) return;
    setBusy(true);
    try {
      const { created } = await draftVariants({
        projectId,
        sourceText: sourceText.trim(),
        platforms,
        personaId: (personaId || undefined) as Id<"personas"> | undefined,
        campaignId: (campaignId || undefined) as Id<"campaigns"> | undefined,
      });
      toast.success(`${created.length} draft${created.length === 1 ? "" : "s"} created`, {
        description: "AI drafts never publish on their own — review, then schedule.",
      });
      setSourceText("");
      onOpenChange(false);
    } catch (e) {
      toast.error("AI draft failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-h3">
            <Sparkles className="size-4 text-terminal-green" /> AI variants
          </DialogTitle>
          <DialogDescription className="font-mono text-caption">
            Paste your message; AI drafts a native version per platform as
            reviewable drafts. Nothing is scheduled or published automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ai-source">Source message</Label>
            <Textarea
              id="ai-source"
              rows={5}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder="Paste an approved piece, a campaign blurb, or just write what you want to say…"
            />
          </div>
          <div className="grid gap-2">
            <Label>Platforms</Label>
            <div className="flex flex-wrap gap-2">
              {POST_CHANNELS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`cursor-pointer rounded-sm border px-2 py-1 font-mono text-caption transition-colors ${
                    platforms.includes(p)
                      ? "border-terminal-green/40 bg-terminal-green-soft text-terminal-green"
                      : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="ai-persona">Persona (optional)</Label>
              <select
                id="ai-persona"
                className="h-9 rounded-md border bg-card px-3 font-mono text-small"
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
              >
                <option value="">— general —</option>
                {personas.map((p) => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ai-campaign">Campaign (optional)</Label>
              <select
                id="ai-campaign"
                className="h-9 rounded-md border bg-card px-3 font-mono text-small"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
              >
                <option value="">— none —</option>
                {campaigns.map((c) => (
                  <option key={c._id} value={c._id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={run}
              disabled={busy || !sourceText.trim() || platforms.length === 0}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generate drafts
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Post form: validated up-front against the platform adapter ───────── */

function PostForm({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const create = useMutation(api.posts.create);
  const [channel, setChannel] = useState<(typeof POST_CHANNELS)[number]>("linkedin");
  const [body, setBody] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [when, setWhen] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!body.trim()) return;
    setIsSaving(true);
    try {
      const scheduledFor = when ? new Date(when).getTime() : undefined;
      await create({
        projectId,
        channel,
        body: body.trim(),
        mediaUrl: mediaUrl.trim() || undefined,
        scheduledFor: scheduledFor && Number.isFinite(scheduledFor) ? scheduledFor : undefined,
      });
      toast.success("Draft saved", {
        description:
          when && Number.isFinite(scheduledFor)
            ? "Now press Schedule in the queue to arm it for publishing."
            : "Open the queue and press Schedule or Publish now when ready.",
      });
      onDone();
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
      setIsSaving(false);
    }
  };

  const needsMedia = channel === "instagram" || channel === "tiktok";

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="po-channel">Platform</Label>
        <select
          id="po-channel"
          className="h-9 rounded-md border bg-card px-3 font-mono text-small"
          value={channel}
          onChange={(e) => setChannel(e.target.value as (typeof POST_CHANNELS)[number])}
        >
          {POST_CHANNELS.map((c) => (
            <option key={c} value={c}>{PLATFORM_LABEL[c]}</option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="po-body">Post</Label>
        <Textarea
          id="po-body"
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What do you want to say? Persona tone guides come from Understand; AI variants can draft this for you."
        />
        {channel === "x" && (
          <p className={`font-mono text-caption ${body.length > 280 ? "text-terminal-red" : "text-muted-foreground"}`}>
            {body.length}/280
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="po-media">
          {needsMedia ? "Media URL (required)" : "Media URL (optional image/video)"}
        </Label>
        <Input
          id="po-media"
          type="url"
          value={mediaUrl}
          onChange={(e) => setMediaUrl(e.target.value)}
          placeholder={needsMedia ? "https://… (image for IG, video for TikTok)" : "https://…"}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="po-when">Target time (optional)</Label>
        <Input
          id="po-when"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
        <p className="font-mono text-caption text-muted-foreground">
          Saved as a draft either way — you arm it with Schedule in the queue.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={handleSave} disabled={isSaving || !body.trim()}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Save draft
        </Button>
      </div>
    </div>
  );
}

/* ── Post row actions ─────────────────────────────────────────────────── */

function PostActions({
  projectId,
  post,
}: {
  projectId: Id<"projects">;
  post: {
    _id: Id<"posts">;
    status: string;
    channel: string;
    body: string;
  };
}) {
  const schedule = useMutation(api.social.executor.schedule);
  const unschedule = useMutation(api.social.executor.unschedule);
  const publishNow = useAction(api.social.executor.publishNow);
  const suggestSchedule = useAction(api.social.copilot.suggestSchedule);
  const [busy, setBusy] = useState<string | null>(null);
  const [aiHint, setAiHint] = useState<string | null>(null);

  const connected = useQuery(api.social.oauth.status, { projectId });
  const connection =
    connected === undefined
      ? undefined
      : connected.find((c) => c.platform === post.channel) ?? null;
  const readiness = getSocialPostReadiness(connection);

  const doSchedule = async () => {
    setBusy("schedule");
    try {
      await schedule({
        id: post._id,
        scheduledFor: Date.now() + 60_000,
      });
      toast.success("Scheduled for ~1 minute from now", {
        description: "The queue executor publishes when the time arrives.",
      });
    } catch (e) {
      toast.error("Schedule failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const doAiTime = async () => {
    setBusy("aitime");
    try {
      const { suggestedFor, reason } = await suggestSchedule({
        projectId,
        platform: post.channel,
        body: post.body,
      });
      await schedule({ id: post._id, scheduledFor: suggestedFor });
      setAiHint(reason);
      toast.success("Scheduled at the AI's suggested time", {
        description: reason,
      });
    } catch (e) {
      toast.error("Could not schedule", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const doPublish = async () => {
    setBusy("publish");
    try {
      const result = await publishNow({ id: post._id });
      toast.success("Published", {
        description: `Provider reference: ${result.providerRef}`,
      });
    } catch (e) {
      toast.error("Publish failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {post.status === "draft" && (
        <>
          {readiness.state !== "ready" && (
            <span
              role="status"
              className="font-mono text-caption text-terminal-amber"
            >
              {readiness.state === "checking"
                ? `Checking ${PLATFORM_LABEL[post.channel] ?? post.channel} connection…`
                : readiness.state === "connect"
                  ? `Connect ${PLATFORM_LABEL[post.channel] ?? post.channel} in the “publish via” section above to schedule or publish.`
                  : `${PLATFORM_LABEL[post.channel] ?? post.channel} publishing is unavailable until this platform is configured.`}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !readiness.canExecute}
            onClick={doSchedule}
          >
            {busy === "schedule" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CalendarClock className="size-3.5" />
            )}
            Schedule
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null || !readiness.canExecute}
            onClick={doAiTime}
            title="AI suggests a time, you approve by scheduling"
          >
            {busy === "aitime" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            AI time
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || !readiness.canExecute}
            onClick={doPublish}
          >
            {busy === "publish" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            Publish now
          </Button>
        </>
      )}
      {post.status === "scheduled" && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("unschedule");
            try {
              await unschedule({ id: post._id });
              toast.success("Pulled back to draft");
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "unschedule" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Undo2 className="size-3.5" />
          )}
          Pull back
        </Button>
      )}
      {aiHint && (
        <span className="font-mono text-caption text-muted-foreground">{aiHint}</span>
      )}
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */

export default function Promote({ projectId }: { projectId: Id<"projects"> }) {
  const campaigns = useQuery(api.campaigns.list, { projectId }) ?? [];
  const posts = useQuery(api.posts.list, { projectId }) ?? [];
  const removeCampaign = useMutation(api.campaigns.remove);
  const removePost = useMutation(api.posts.remove);
  const updateCampaign = useMutation(api.campaigns.update);
  const [openCampaign, setOpenCampaign] = useState(false);
  const [openPost, setOpenPost] = useState(false);
  const [openAi, setOpenAi] = useState(false);

  return (
    <div>
      <ModuleHeader
        icon={Megaphone}
        title="Promote"
        subtitle="Campaigns and social publishing — AI drafts, you approve, receipts are real"
      >
        <div className="flex flex-wrap items-center gap-2">
          <BrandUseChip projectId={projectId} use="social" />
          <Button variant="outline" onClick={() => setOpenAi(true)}>
            <Sparkles className="size-4" /> AI variants
          </Button>
          <Dialog open={openPost} onOpenChange={setOpenPost}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <CalendarClock className="size-4" /> New post
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-mono text-h3">New post</DialogTitle>
                <DialogDescription className="font-mono text-caption">
                  Drafts are validated per platform up front; scheduling arms
                  the queue.
                </DialogDescription>
              </DialogHeader>
              <PostForm projectId={projectId} onDone={() => setOpenPost(false)} />
            </DialogContent>
          </Dialog>
          <Dialog open={openCampaign} onOpenChange={setOpenCampaign}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4" /> New campaign
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-mono text-h3">
                  New campaign
                </DialogTitle>
                <DialogDescription className="font-mono text-caption">
                  Campaigns link to personas; email campaigns only ever send to
                  consented contacts.
                </DialogDescription>
              </DialogHeader>
              <CampaignForm projectId={projectId} onDone={() => setOpenCampaign(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </ModuleHeader>

      <ConnectionsPanel projectId={projectId} />

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="social">Social queue</TabsTrigger>
        </TabsList>
        <TabsContent value="campaigns" className="mt-4">
          {campaigns.length === 0 ? (
            <ModuleEmpty
              icon={Megaphone}
              title="No campaigns yet"
              hint="Email, ads or social campaigns — drafts stay private until you start them, and email sends are consent-checked per contact."
              action={
                <Button onClick={() => setOpenCampaign(true)}>
                  <Plus className="size-4" /> Create a campaign
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3">
              {campaigns.map((c) => (
                <div
                  key={c._id}
                  className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-small font-medium">{c.name}</p>
                    <p className="font-mono text-caption text-muted-foreground">
                      {c.channel}
                      {c.budgetCents
                        ? ` · €${(c.budgetCents / 100).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  {c.status === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await updateCampaign({ id: c._id, status: "running" });
                          toast.success("Campaign started");
                        } catch (e) {
                          toast.error("Could not start", {
                            description:
                              e instanceof Error ? e.message : "Try again.",
                          });
                        }
                      }}
                    >
                      Start
                    </Button>
                  )}
                  {c.status === "running" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateCampaign({ id: c._id, status: "paused" })}
                    >
                      Pause
                    </Button>
                  )}
                  {c.status === "paused" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateCampaign({ id: c._id, status: "running" })}
                    >
                      Resume
                    </Button>
                  )}
                  {c.status === "running" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => updateCampaign({ id: c._id, status: "done" })}
                    >
                      <CheckCircle2 className="size-3.5" /> Mark done
                    </Button>
                  )}
                  <StatusBadge
                    status={c.status}
                    /* BP-03: a local "running" is the user's own tracking,
                       not a provider fact — say so next to the badge. */
                    detail={
                      (c as { trackingSource?: "local" | "provider" })
                        .trackingSource === "provider"
                        ? "provider-synced"
                        : "MOSAI-local"
                    }
                  />
                  <ConfirmDelete
                    what={`"${c.name}"`}
                    onConfirm={async () => {
                      await removeCampaign({ id: c._id });
                      toast.success("Campaign deleted");
                    }}
                    trigger={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Delete ${c.name}`}
                        className="text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="social" className="mt-4">
          {posts.length === 0 ? (
            <ModuleEmpty
              icon={CalendarClock}
              title="Nothing queued"
              hint="Draft posts for Facebook, Instagram, LinkedIn, X and TikTok — or let AI draft platform variants from any message. Nothing publishes until you schedule or press Publish now."
              action={
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setOpenAi(true)}>
                    <Sparkles className="size-4" /> AI variants
                  </Button>
                  <Button onClick={() => setOpenPost(true)}>
                    <Plus className="size-4" /> New post
                  </Button>
                </div>
              }
            />
          ) : (
            <div className="grid gap-3">
              {[...posts]
                .sort((a, b) => (b.scheduledFor ?? 0) - (a.scheduledFor ?? 0))
                .map((p) => (
                  <div
                    key={p._id}
                    className="flex flex-wrap items-start gap-3 rounded-md border bg-card p-4 shadow-card"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-mono text-small">{p.body}</p>
                      <p className="mt-1 font-mono text-caption text-muted-foreground">
                        {PLATFORM_LABEL[p.channel] ?? p.channel}
                        {p.origin === "copilot" && " · AI draft"}
                        {p.scheduledFor
                          ? ` · ${new Date(p.scheduledFor).toLocaleString()}`
                          : " · draft"}
                        {p.publishedAt
                          ? ` · published ${new Date(p.publishedAt).toLocaleString()}`
                          : ""}
                      </p>
                      {p.errorDetail && (
                        <p className="mt-1 flex items-start gap-1 font-mono text-caption text-terminal-red">
                          <XCircle className="mt-0.5 size-3 shrink-0" />
                          {p.errorDetail}
                        </p>
                      )}
                    </div>
                    <StatusBadge status={p.status} />
                    <PostActions projectId={projectId} post={p} />
                    <ConfirmDelete
                      what="this post"
                      onConfirm={async () => {
                        await removePost({ id: p._id });
                        toast.success("Post deleted");
                      }}
                      trigger={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Delete post"
                          className="text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                    />
                  </div>
                ))}
            </div>
          )}        </TabsContent>
      </Tabs>
      <AiVariantsDialog
        projectId={projectId}
        open={openAi}
        onOpenChange={setOpenAi}
      />
    </div>
  );
}


function CampaignForm({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const personas = useQuery(api.personas.list, { projectId }) ?? [];
  const create = useMutation(api.campaigns.create);
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<(typeof CAMPAIGN_CHANNELS)[number]>("email");
  const [budget, setBudget] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      const budgetCents = budget
        ? Math.round(parseFloat(budget) * 100)
        : undefined;
      await create({
        projectId,
        name: name.trim(),
        channel,
        budgetCents: Number.isFinite(budgetCents as number) ? budgetCents : undefined,
        personaId: (personaId || undefined) as Id<"personas"> | undefined,
      });
      toast.success("Campaign created", {
        description: "Draft — start it when the content is ready.",
      });
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
        <Label htmlFor="cp-name">Campaign name</Label>
        <Input
          id="cp-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Office coffee — winter push"
          autoFocus
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="cp-channel">Channel</Label>
          <select
            id="cp-channel"
            className="h-9 rounded-md border bg-card px-3 font-mono text-small"
            value={channel}
            onChange={(e) =>
              setChannel(e.target.value as (typeof CAMPAIGN_CHANNELS)[number])
            }
          >
            {CAMPAIGN_CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cp-budget">Budget (€)</Label>
          <Input
            id="cp-budget"
            type="number"
            min="0"
            step="1"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            placeholder="Optional"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="cp-persona">Persona</Label>
        <select
          id="cp-persona"
          className="h-9 rounded-md border bg-card px-3 font-mono text-small"
          value={personaId}
          onChange={(e) => setPersonaId(e.target.value)}
        >
          <option value="">— any / all —</option>
          {personas.map((p) => (
            <option key={p._id} value={p._id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={handleSave} disabled={isSaving || !name.trim()}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Create campaign
        </Button>
      </div>
    </div>
  );
}
