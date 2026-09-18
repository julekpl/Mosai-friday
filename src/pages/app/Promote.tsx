import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  Megaphone,
  Plus,
  Trash2,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
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

const CAMPAIGN_CHANNELS = ["email", "ads", "social"] as const;
const POST_CHANNELS = ["meta", "tiktok", "linkedin", "x"] as const;

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
        scheduledFor: scheduledFor && Number.isFinite(scheduledFor) ? scheduledFor : undefined,
      });
      toast.success(scheduledFor ? "Post scheduled" : "Post saved as draft");
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
        <Label htmlFor="po-channel">Channel</Label>
        <select
          id="po-channel"
          className="h-9 rounded-md border bg-card px-3 font-mono text-small"
          value={channel}
          onChange={(e) => setChannel(e.target.value as (typeof POST_CHANNELS)[number])}
        >
          {POST_CHANNELS.map((c) => (
            <option key={c} value={c}>{c}</option>
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
          placeholder="What do you want to say? Personas tone guides come from Understand."
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="po-when">Schedule for</Label>
        <Input
          id="po-when"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={handleSave} disabled={isSaving || !body.trim()}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          {when ? "Schedule post" : "Save draft"}
        </Button>
      </div>
    </div>
  );
}

export default function Promote({ projectId }: { projectId: Id<"projects"> }) {
  const campaigns = useQuery(api.campaigns.list, { projectId }) ?? [];
  const posts = useQuery(api.posts.list, { projectId }) ?? [];
  const removeCampaign = useMutation(api.campaigns.remove);
  const removePost = useMutation(api.posts.remove);
  const updateCampaign = useMutation(api.campaigns.update);
  const [openCampaign, setOpenCampaign] = useState(false);
  const [openPost, setOpenPost] = useState(false);

  return (
    <div>
      <ModuleHeader
        icon={Megaphone}
        title="Promote"
        subtitle="Campaigns and social scheduling — everything consent-checked at send time"
      >
        <div className="flex gap-2">
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
                Scheduled posts show in the queue; drafts stay editable.
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
                  <StatusBadge status={c.status} />
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
              title="Nothing scheduled"
              hint="Draft or schedule posts for Meta, TikTok, LinkedIn and X. Content from the Create module can be pushed here as a starting point."
              action={
                <Button onClick={() => setOpenPost(true)}>
                  <Plus className="size-4" /> Create a post
                </Button>
              }
            />
          ) : (
            <div className="grid gap-3">
              {[...posts]
                .sort((a, b) => (b.scheduledFor ?? 0) - (a.scheduledFor ?? 0))
                .map((p) => (
                  <div
                    key={p._id}
                    className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 font-mono text-small">{p.body}</p>
                      <p className="mt-1 font-mono text-caption text-muted-foreground">
                        {p.channel}
                        {p.scheduledFor
                          ? ` · ${new Date(p.scheduledFor).toLocaleString()}`
                          : " · draft"}
                      </p>
                    </div>
                    <StatusBadge status={p.status} />
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
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
