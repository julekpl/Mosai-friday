import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Plus,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import {
  ConfirmDelete,
  ModuleEmpty,
  SourceChip,
  StatusBadge,
  DATA_PROVIDERS,
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const KINDS = [
  "seo",
  "geo",
  "content_gap",
  "channel",
  "recommendation",
] as const;

function InsightForm({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const create = useMutation(api.insights.create);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("recommendation");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [source, setSource] = useState("manual");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setIsSaving(true);
    try {
      await create({
        projectId,
        kind,
        title: title.trim(),
        body: body.trim() || undefined,
        source,
      });
      toast.success("Insight recorded");
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="in-kind">Type</Label>
          <select
            id="in-kind"
            className="h-9 rounded-md border bg-card px-3 font-mono text-small"
            value={kind}
            onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>{k.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="in-source">Data source</Label>
          <select
            id="in-source"
            className="h-9 rounded-md border bg-card px-3 font-mono text-small"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            {["manual", "internal", ...DATA_PROVIDERS.map((p) => p.id)].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="in-title">Insight</Label>
        <Input
          id="in-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Blog impressions up 40% — gsc, last 28 days"
          autoFocus
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="in-body">Detail</Label>
        <Textarea
          id="in-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What should be done about it, and why?"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={handleSave} disabled={isSaving || !title.trim()}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Record insight
        </Button>
      </div>
    </div>
  );
}

export default function Grow({ projectId }: { projectId: Id<"projects"> }) {
  const insights = useQuery(api.insights.list, { projectId }) ?? [];
  const connections = useQuery(api.connections.list, { projectId }) ?? [];
  const remove = useMutation(api.insights.remove);
  const update = useMutation(api.insights.update);
  const beginAuthorization = useMutation(api.connections.beginAuthorization);
  const disconnect = useMutation(api.connections.disconnect);
  const [open, setOpen] = useState(false);

  const connectionByProvider = new Map(
    connections.map((connection) => [connection.provider, connection]),
  );

  return (
    <div>
      <ModuleHeader
        icon={TrendingUp}
        title="Grow"
        subtitle="Insights with source and freshness — never blended, never hidden"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Record insight
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">
                New insight
              </DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Every insight carries its source and as-of date. Nothing is
                averaged across sources.
              </DialogDescription>
            </DialogHeader>
            <InsightForm projectId={projectId} onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </ModuleHeader>

      {/* Connection status strip */}
      <div className="mb-6 flex flex-wrap gap-2">
        {DATA_PROVIDERS.map((p) => {
          const connection = connectionByProvider.get(p.id);
          const status = connection?.status ?? "available";
          const isConnected = status === "connected";
          const isAuthorizing = status === "authorizing";
          return (
            <button
              key={p.id}
              disabled={isAuthorizing}
              onClick={async () => {
                try {
                  if (isConnected) {
                    await disconnect({ projectId, provider: p.id });
                    toast.success(`${p.label} disconnected`);
                  } else if (!isAuthorizing) {
                    await beginAuthorization({ projectId, provider: p.id });
                    toast.success(`${p.label} authorization started`, {
                      description: "This provider still needs a verified OAuth flow before it can be used.",
                    });
                  }
                } catch (e) {
                  toast.error("Connection change failed", {
                    description: e instanceof Error ? e.message : "Try again.",
                  });
                }
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-caption ease-terminal hover:bg-accent disabled:cursor-wait disabled:opacity-70",
                isConnected
                  ? "border-terminal-green/40 bg-terminal-green-soft text-terminal-green"
                  : isAuthorizing
                    ? "border-terminal-amber/40 bg-terminal-amber-soft text-terminal-amber"
                    : "text-muted-foreground",
              )}
              aria-pressed={isConnected}
              title={connection?.detail ?? p.detail}
            >
              {isConnected ? (
                <CheckCircle2 className="size-3.5" />
              ) : isAuthorizing ? (
                <CircleAlert className="size-3.5" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {p.label}
              {isAuthorizing && " · authorizing"}
            </button>
          );
        })}
      </div>

      {insights.length === 0 ? (
        <ModuleEmpty
          icon={TrendingUp}
          title="No insights yet"
          hint="Connect GA4, Search Console or ad accounts above, then record insights against them. Each insight keeps its source and as-of date — honest gaps stay visible."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Record the first insight
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3">
          {insights.map((i) => (
            <div
              key={i._id}
              className="flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-small font-medium">{i.title}</p>
                {i.body && (
                  <p className="mt-0.5 font-mono text-caption text-muted-foreground">
                    {i.body}
                  </p>
                )}
              </div>
              <Badge
                variant="outline"
                className="font-mono text-caption text-muted-foreground"
              >
                {i.kind.replace(/_/g, " ")}
              </Badge>
              <SourceChip source={i.source} asOf={i.dataAsOf} />
              <StatusBadge status={i.freshness ?? "fresh"} />
              <div className="flex shrink-0 gap-1">
                {i.status !== "done" && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Mark insight done"
                    onClick={() => update({ id: i._id, status: "done" })}
                  >
                    <Check className="size-3.5" />
                  </Button>
                )}
                <ConfirmDelete
                  what="this insight"
                  onConfirm={async () => {
                    await remove({ id: i._id });
                    toast.success("Insight deleted");
                  }}
                  trigger={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete insight"
                      className="text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
