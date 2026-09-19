import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Copy,
  Eye,
  Globe,
  History,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  BLOCK_REGISTRY,
  getBlockDef,
  newBlockId,
  type PageDocument,
} from "@/lib/cms/blocks";
import { PageRenderer } from "./PageRenderer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type PageDoc = Doc<"cmsPages">;
type RevisionDoc = Doc<"pageRevisions">;

type SaveState = "idle" | "saving" | "saved" | "error";

export function PageEditor({
  page,
  onBack,
}: {
  page: PageDoc;
  onBack: () => void;
}) {
  const revisions = (useQuery(api.cms.listRevisions, {
    pageId: page._id,
  }) ?? []) as RevisionDoc[];

  const saveDraft = useMutation(api.cms.saveDraft);
  const publish = useMutation(api.cms.publishPage);
  const restore = useMutation(api.cms.restoreRevision);
  const updatePage = useMutation(api.cms.updatePage);

  const draft = useMemo(
    () =>
      revisions.find(
        (r) =>
          r._id === page.latestDraftRevisionId || (r.state === "draft" && !page.latestDraftRevisionId),
      ) ?? revisions.find((r) => r.state === "draft") ?? null,
    [revisions, page.latestDraftRevisionId],
  );

  const [doc, setDoc] = useState<PageDocument>(() =>
    draft
      ? structuredClone(draft.document)
      : { schemaVersion: 1, blocks: [] },
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [publishResult, setPublishResult] = useState<{
    blocking: string[];
    recommendations: string[];
  } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const undoStack = useRef<PageDocument[]>([]);
  const redoStack = useRef<PageDocument[]>([]);
  const dirtyRef = useRef(false);

  const pushUndo = (prev: PageDocument) => {
    undoStack.current = [...undoStack.current.slice(-49), prev];
    redoStack.current = [];
  };

  const mutateDoc = (fn: (d: PageDocument) => PageDocument) => {
    setDoc((current) => {
      pushUndo(current);
      return fn(current);
    });
    dirtyRef.current = true;
  };

  const undo = useCallback(() => {
    setDoc((current) => {
      const prev = undoStack.current.pop();
      if (!prev) return current;
      redoStack.current.push(current);
      return prev;
    });
    dirtyRef.current = true;
  }, []);

  const redo = useCallback(() => {
    setDoc((current) => {
      const next = redoStack.current.pop();
      if (!next) return current;
      undoStack.current.push(current);
      return next;
    });
    dirtyRef.current = true;
  }, []);

  // keyboard undo/redo (editor-session scope, §121)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // autosave — saves the draft, never publishes (§10, §134.4)
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(async () => {
      setSaveState("saving");
      try {
        await saveDraft({ pageId: page._id, document: doc });
        dirtyRef.current = false;
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
        toast.error("Autosave failed", {
          description: e instanceof Error ? e.message : "Try again.",
        });
      }
    }, 900);
    return () => clearTimeout(t);
  }, [doc, page._id, saveDraft]);

  const addBlock = (type: string) => {
    const def = getBlockDef(type);
    if (!def) return;
    const block = {
      id: newBlockId(),
      type: def.type,
      version: def.version,
      props: structuredClone(def.defaults),
    };
    mutateDoc((d) => ({ ...d, blocks: [...d.blocks, block] }));
    setSelectedId(block.id);
  };

  const updateProps = (id: string, key: string, value: unknown) => {
    mutateDoc((d) => ({
      ...d,
      blocks: d.blocks.map((b) =>
        b.id === id ? { ...b, props: { ...b.props, [key]: value } } : b,
      ),
    }));
  };

  const moveBlock = (id: string, dir: -1 | 1) => {
    mutateDoc((d) => {
      const idx = d.blocks.findIndex((b) => b.id === id);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= d.blocks.length) return d;
      const blocks = [...d.blocks];
      const [item] = blocks.splice(idx, 1);
      blocks.splice(to, 0, item);
      return { ...d, blocks };
    });
  };

  const duplicateBlock = (id: string) => {
    mutateDoc((d) => {
      const idx = d.blocks.findIndex((b) => b.id === id);
      if (idx < 0) return d;
      const copy = { ...structuredClone(d.blocks[idx]), id: newBlockId() };
      const blocks = [...d.blocks];
      blocks.splice(idx + 1, 0, copy);
      return { ...d, blocks };
    });
  };

  const removeBlock = (id: string) => {
    mutateDoc((d) => ({ ...d, blocks: d.blocks.filter((b) => b.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  };

  const selected = doc.blocks.find((b) => b.id === selectedId) ?? null;
  const selectedDef = selected ? getBlockDef(selected.type) : null;

  const openPublishDialog = async () => {
    // flush pending autosave first so checks see the latest document
    if (dirtyRef.current) {
      try {
        await saveDraft({ pageId: page._id, document: doc });
        dirtyRef.current = false;
      } catch {
        /* checks still run against the stored draft */
      }
    }
    setShowPreview(false);
    // fetch fresh checks via the reactive query's sibling — we reuse publishPage's
    // inline validation on click, but show recommendations from getPublishChecks
    setShowPublishChecks(true);
  };
  const [showPublishChecks, setShowPublishChecks] = useState(false);

  const doPublish = async () => {
    setPublishing(true);
    try {
      await saveDraft({ pageId: page._id, document: doc });
      dirtyRef.current = false;
      await publish({ pageId: page._id });
      toast.success("Published", {
        description: "This version is now live. Earlier versions stay in History.",
      });
      setShowPublishChecks(false);
    } catch (e) {
      setPublishResult({
        blocking: [e instanceof Error ? e.message : "Publish failed"],
        recommendations: [],
      });
    } finally {
      setPublishing(false);
    }
  };

  const restoreAsDraft = async (revision: RevisionDoc) => {
    try {
      await restore({ revisionId: revision._id });
      toast.success(`Version ${revision.version} restored as a new draft`);
      setShowHistory(false);
    } catch (e) {
      toast.error("Restore failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  const saveSeo = async (patch: Partial<NonNullable<PageDoc["seo"]>>) => {
    try {
      await updatePage({ id: page._id, seo: { ...page.seo, ...patch } });
    } catch (e) {
      toast.error("SEO save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  const saveStateLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved just now"
        : saveState === "error"
          ? "Save failed"
          : "Draft";

  return (
    <div className="grid gap-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="size-4" /> Pages
        </Button>
        <div className="min-w-0">
          <p className="truncate font-mono text-small font-medium">{page.title}</p>
          <p className="font-mono text-caption text-muted-foreground">
            {page.fullPath}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "ml-2 font-mono text-caption",
            page.status === "published" && dirtyRef.current
              ? "border-terminal-amber/40 bg-terminal-amber-soft text-terminal-amber"
              : "",
          )}
        >
          {page.status === "published" && dirtyRef.current
            ? "draft changes"
            : page.status}
        </Badge>
        <span className="font-mono text-caption text-muted-foreground">
          {saveStateLabel}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={undo} aria-label="Undo">
            ↺
          </Button>
          <Button size="sm" variant="ghost" onClick={redo} aria-label="Redo">
            ↻
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowHistory(true)}
          >
            <History className="size-3.5" /> History
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowPreview((v) => !v)}
          >
            <Eye className="size-3.5" /> {showPreview ? "Edit" : "Preview"}
          </Button>
          <Button size="sm" onClick={openPublishDialog}>
            <Globe className="size-3.5" /> Publish
          </Button>
        </div>
      </div>

      {showPreview ? (
        <div className="rounded-md border bg-card p-6 shadow-card">
          <p className="mb-4 font-mono text-caption text-muted-foreground">
            preview · draft revision
          </p>
          <PageRenderer doc={doc} />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          {/* Block list */}
          <div className="grid gap-2">
            {doc.blocks.length === 0 && (
              <div className="rounded-md border border-dashed p-8 text-center font-mono text-caption text-muted-foreground">
                No sections yet — add one from the panel.
              </div>
            )}
            {doc.blocks.map((b, i) => {
              const def = getBlockDef(b.type);
              return (
                <div
                  key={b.id}
                  className={cn(
                    "cursor-pointer rounded-md border bg-card p-3 shadow-card transition-colors ease-terminal hover:bg-accent",
                    selectedId === b.id && "border-terminal-green/60",
                  )}
                  onClick={() => setSelectedId(b.id)}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-caption text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <p className="font-mono text-small font-medium">
                      {def?.label ?? b.type}
                    </p>
                    {def?.commerce && (
                      <Badge
                        variant="outline"
                        className="font-mono text-caption text-terminal-blue"
                      >
                        live data
                      </Badge>
                    )}
                    <div className="ml-auto flex items-center gap-0.5">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Move up"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBlock(b.id, -1);
                        }}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Move down"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveBlock(b.id, 1);
                        }}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Duplicate"
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateBlock(b.id);
                        }}
                      >
                        <Copy className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete"
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeBlock(b.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-0.5 truncate font-mono text-caption text-muted-foreground">
                    {summarizeBlock(b)}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Right panel */}
          <div className="grid content-start gap-4">
            <div className="rounded-md border bg-card p-4 shadow-card">
              <p className="font-mono text-caption text-muted-foreground">add section</p>
              <div className="mt-2 grid gap-1.5">
                {BLOCK_REGISTRY.map((def) => (
                  <button
                    key={def.type}
                    type="button"
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-small ease-terminal hover:bg-accent"
                    onClick={() => addBlock(def.type)}
                  >
                    <Plus className="size-3.5 text-terminal-green" />
                    {def.label}
                    {def.commerce && (
                      <Badge
                        variant="outline"
                        className="ml-auto font-mono text-caption text-terminal-blue"
                      >
                        Sell
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {selected && selectedDef && (
              <div className="rounded-md border bg-card p-4 shadow-card">
                <p className="font-mono text-caption text-muted-foreground">
                  {selectedDef.label} · v{selected.version}
                </p>
                <div className="mt-3 grid gap-3">
                  {selectedDef.fields.map((f) => (
                    <BlockFieldInput
                      key={f.key}
                      field={f}
                      value={selected.props[f.key]}
                      onChange={(v) => updateProps(selected.id, f.key, v)}
                    />
                  ))}
                  {selectedDef.commerce && (
                    <p className="rounded-md border border-terminal-blue/40 bg-terminal-blue-soft px-3 py-2 font-mono text-caption text-terminal-blue">
                      This block stores IDs only — price, stock and availability
                      always come from Sell at render time.
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-md border bg-card p-4 shadow-card">
              <p className="font-mono text-caption text-muted-foreground">seo</p>
              <div className="mt-2 grid gap-2">
                <div className="grid gap-1">
                  <Label className="font-mono text-caption">Meta title</Label>
                  <Input
                    defaultValue={page.seo?.title ?? ""}
                    onBlur={(e) => void saveSeo({ title: e.target.value || undefined })}
                  />
                </div>
                <div className="grid gap-1">
                  <Label className="font-mono text-caption">Meta description</Label>
                  <Textarea
                    rows={3}
                    defaultValue={page.seo?.metaDescription ?? ""}
                    onBlur={(e) =>
                      void saveSeo({ metaDescription: e.target.value || undefined })
                    }
                  />
                </div>
                <label className="flex items-center gap-2 font-mono text-caption">
                  <input
                    type="checkbox"
                    defaultChecked={page.seo?.noindex ?? false}
                    onChange={(e) => void saveSeo({ noindex: e.target.checked })}
                  />
                  Hide from search engines (noindex)
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Publish dialog: blocking vs recommendations (§115) */}
      <PublishDialog
        open={showPublishChecks}
        onOpenChange={setShowPublishChecks}
        pageId={page._id}
        publishing={publishing}
        onPublish={doPublish}
        result={publishResult}
      />

      {/* History (§11): preview state, restore as new draft */}
      <Dialog open={showHistory} onOpenChange={setShowHistory}>
        <DialogContent className="max-h-[80vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">Version history</DialogTitle>
            <DialogDescription className="font-mono text-caption">
              Restoring never overwrites history — it creates a new draft.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            {revisions.map((r) => (
              <div
                key={r._id}
                className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 shadow-card"
              >
                <span className="font-mono text-small font-medium">
                  v{r.version}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono text-caption",
                    r.state === "published" &&
                      "border-terminal-green/40 bg-terminal-green-soft text-terminal-green",
                    r.state === "draft" &&
                      "border-terminal-amber/40 bg-terminal-amber-soft text-terminal-amber",
                  )}
                >
                  {r.state}
                </Badge>
                <span className="font-mono text-caption text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
                <div className="ml-auto flex gap-1">
                  {r.state !== "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void restoreAsDraft(r)}
                    >
                      Restore as draft
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PublishDialog({
  open,
  onOpenChange,
  pageId,
  publishing,
  onPublish,
  result,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pageId: Id<"cmsPages">;
  publishing: boolean;
  onPublish: () => void;
  result: { blocking: string[]; recommendations: string[] } | null;
}) {
  const checks = useQuery(
    api.cms.getPublishChecks,
    open ? { pageId } : "skip",
  );
  const blocking = result?.blocking ?? checks?.blocking ?? [];
  const recommendations =
    result?.recommendations ?? checks?.recommendations ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-h3">Ready to publish?</DialogTitle>
          <DialogDescription className="font-mono text-caption">
            Publishing promotes this draft. The previous version stays recoverable.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {blocking.length === 0 ? (
            <p className="flex items-center gap-2 font-mono text-caption text-terminal-green">
              <CheckCircle2 className="size-4" /> 0 blocking issues
            </p>
          ) : (
            blocking.map((b, i) => (
              <p
                key={i}
                className="flex items-start gap-2 rounded-md border border-terminal-red/40 bg-terminal-red-soft px-3 py-2 font-mono text-caption text-terminal-red"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {b}
              </p>
            ))
          )}
          {recommendations.map((r, i) => (
            <p
              key={i}
              className="flex items-start gap-2 rounded-md border border-terminal-amber/40 bg-terminal-amber-soft px-3 py-2 font-mono text-caption text-terminal-amber"
            >
              <ChevronDown className="mt-0.5 size-3.5 shrink-0" /> {r}
            </p>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onPublish} disabled={publishing || blocking.length > 0}>
            {publishing ? <Save className="size-4 animate-spin" /> : <Globe className="size-4" />}
            Publish now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BlockFieldInput({
  field,
  value,
  onChange,
}: {
  field: {
    key: string;
    label: string;
    kind: string;
    required?: boolean;
    itemFields?: { key: string; label: string; required?: boolean }[];
  };
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (field.kind === "list") {
    const items = Array.isArray(value)
      ? (value as Record<string, unknown>[])
      : [];
    return (
      <div className="grid gap-1.5">
        <Label className="font-mono text-caption">{field.label}</Label>
        {items.map((item, i) => (
          <div key={i} className="grid gap-1 rounded-md border p-2">
            {(field.itemFields ?? []).map((sub) => (
              <Input
                key={sub.key}
                value={String(item[sub.key] ?? "")}
                placeholder={sub.label}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...item, [sub.key]: e.target.value };
                  onChange(next);
                }}
              />
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3" /> Remove item
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange([...items, {}])}
        >
          <Plus className="size-3" /> Add item
        </Button>
      </div>
    );
  }

  if (field.kind === "text") {
    return (
      <div className="grid gap-1">
        <Label className="font-mono text-caption">
          {field.label}
          {field.required && <span className="text-terminal-red"> *</span>}
        </Label>
        <Textarea
          rows={4}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (field.kind === "number") {
    return (
      <div className="grid gap-1">
        <Label className="font-mono text-caption">{field.label}</Label>
        <Input
          type="number"
          value={value === undefined ? "" : String(value)}
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
        />
      </div>
    );
  }

  if (field.kind === "assetRef") {
    return (
      <div className="grid gap-1">
        <Label className="font-mono text-caption">
          {field.label} (asset id)
        </Label>
        <Input
          value={String(value ?? "")}
          placeholder="paste an asset id from Assets"
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </div>
    );
  }

  if (field.kind === "collectionRef") {
    return (
      <div className="grid gap-1">
        <Label className="font-mono text-caption">
          {field.label} (collection id)
        </Label>
        <Input
          value={String(value ?? "")}
          placeholder="paste a collection id from Sell"
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-1">
      <Label className="font-mono text-caption">
        {field.label}
        {field.required && <span className="text-terminal-red"> *</span>}
      </Label>
      <Input
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function summarizeBlock(b: {
  type: string;
  props: Record<string, unknown>;
}): string {
  switch (b.type) {
    case "hero":
      return String(b.props.heading ?? "");
    case "richText":
      return String(b.props.html ?? "").replace(/<[^>]*>/g, "").slice(0, 80);
    case "image":
      return String(b.props.alt ?? "(no alt)");
    case "quote":
      return String(b.props.text ?? "").slice(0, 80);
    case "cta":
      return String(b.props.heading ?? "");
    case "featureGrid":
    case "faq":
    case "stats": {
      const items = Array.isArray(b.props.items) ? b.props.items : [];
      return `${items.length} item${items.length === 1 ? "" : "s"}`;
    }
    case "productGrid":
      return b.props.collectionId
        ? `collection ${String(b.props.collectionId).slice(0, 12)}…`
        : "no collection selected";
    default:
      return "";
  }
}
