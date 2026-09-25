import { useMemo, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import { BrandUseChip } from "@/components/app/brand/BrandUse";
import {
  ConfirmDelete,
  ModuleEmpty,
  StatusBadge,
} from "@/components/app/module-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type ProductBundle = {
  _id: Id<"products">;
  title: string;
  slug?: string;
  description?: string;
  status?: "draft" | "active" | "archived";
  brand?: string;
  collectionIds?: Id<"collections">[];
  enrichment?: {
    seoTitle?: string;
    seoDescription?: string;
    origin?: "ai" | "user";
  };
  variants: Array<{
    _id: Id<"productVariants">;
    isDefault: boolean;
    title?: string;
    priceCents?: number;
    currency: string;
    inventoryCount?: number;
    availability?: string;
    availabilityDate?: number;
    sku?: string;
    gtin?: string;
    identifierStatus?: string;
  }>;
  media: Array<{
    _id: Id<"productMedia">;
    url: string;
    alt?: string;
    variantId?: Id<"productVariants">;
  }>;
  readiness: {
    state: "ready" | "needs_attention" | "blocked";
    issues: Array<{
      scope: "product" | "variant";
      objectId: string;
      variantLabel?: string;
      field: string;
      severity: "error" | "warning" | "info";
      fixType: "ai_safe" | "user_input" | "external_action";
      message: string;
    }>;
    recommendations: Array<{ field: string; message: string; fixType: string }>;
  };
};

const READY_TONE: Record<string, string> = {
  ready: "text-terminal-green",
  needs_attention: "text-terminal-amber",
  blocked: "text-terminal-red",
};

/* ── Add product dialog ─────────────────────────────────────────────────── */

function AddProductDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const create = useMutation(api.products.create);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [inventory, setInventory] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [hasGtin, setHasGtin] = useState<"unknown" | "yes" | "no">("unknown");
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    if (!title.trim()) return;
    setIsSaving(true);
    try {
      const parsed = price ? Math.round(parseFloat(price) * 100) : undefined;
      await create({
        projectId,
        title: title.trim(),
        priceCents:
          parsed != null && Number.isFinite(parsed) ? parsed : undefined,
        currency,
        inventoryCount: inventory ? parseInt(inventory, 10) : undefined,
        imageUrl: imageUrl.trim() || undefined,
        identifierStatus:
          hasGtin === "yes"
            ? "has_identifiers"
            : hasGtin === "no"
              ? "no_identifiers_exist"
              : "unknown",
        status: "active",
      });
      toast.success("Product added");
      setTitle("");
      setPrice("");
      setInventory("");
      setImageUrl("");
      setHasGtin("unknown");
      onOpenChange(false);
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-h3">Add product</DialogTitle>
          <DialogDescription className="font-mono text-caption">
            Products flow into the feed, content, website and campaigns.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="p-title">Product name</Label>
            <Input
              id="p-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Ergonomic office chair"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-price">Price</Label>
              <Input
                id="p-price"
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["EUR", "USD", "GBP", "PLN", "SEK"].map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="p-stock">Stock count</Label>
              <Input
                id="p-stock"
                type="number"
                min="0"
                value={inventory}
                onChange={(e) => setInventory(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="p-img">Image URL</Label>
              <Input
                id="p-img"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Does this product have a barcode / GTIN?</Label>
            <div className="flex gap-2">
              {(
                [
                  ["yes", "Yes"],
                  ["no", "No, it doesn't"],
                  ["unknown", "Not sure"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setHasGtin(v)}
                  className={cn(
                    "cursor-pointer rounded-md border px-3 py-1.5 font-mono text-caption ease-terminal",
                    hasGtin === v
                      ? "border-terminal-green/40 bg-terminal-green-soft text-terminal-green"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {hasGtin === "yes" && (
              <p className="font-mono text-caption text-muted-foreground">
                You can enter the GTIN/SKU in the product inspector.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={isSaving || !title.trim()}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              Add product
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── AI fix proposal card ──────────────────────────────────────────────── */

function AiFixCard({
  issue,
  product,
  projectId,
}: {
  issue: { field: string };
  product: ProductBundle;
  projectId: Id<"projects">;
}) {
  const generateDescription = useAction(api.sellAI.generateDescription);
  const generateSeo = useAction(api.sellAI.generateSeo);
  const generateAltText = useAction(api.sellAI.generateAltText);
  const update = useMutation(api.products.update);
  const setAlt = useMutation(api.media.setAlt);

  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<{
    description?: string;
    alt?: string;
    seoTitle?: string;
    seoDescription?: string;
  } | null>(null);

  const primaryImage = product.media.find((m) => !m.variantId);

  const generate = async () => {
    setBusy(true);
    try {
      if (issue.field === "image_alt") {
        if (!primaryImage) {
          toast.error("Add an image first — alt text describes an image.");
          return;
        }
        const r = await generateAltText({
          imageUrl: primaryImage.url,
          title: product.title,
        });
        setProposal(r);
      } else if (issue.field === "description") {
        const hasDescription = (product.description?.length ?? 0) >= 80;
        const r = await generateDescription({
          projectId,
          title: product.title,
          brand: product.brand,
          currentDescription: hasDescription ? product.description : undefined,
          mode: hasDescription ? "improve" : "fill_missing",
        });
        setProposal(r);
      } else if (issue.field === "seo") {
        const r = await generateSeo({
          title: product.title,
          description: product.description,
          currentSeoTitle: product.enrichment?.seoTitle,
          currentSeoDescription: product.enrichment?.seoDescription,
          projectId,
        });
        setProposal(r);
      }
    } catch (e) {
      toast.error("Generation failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    try {
      if (proposal.description) {
        await update({ id: product._id, description: proposal.description });
      } else if (proposal.alt) {
        await setAlt({ productId: product._id, alt: proposal.alt });
      } else if (proposal.seoTitle || proposal.seoDescription) {
        await update({
          id: product._id,
          enrichment: {
            seoTitle: proposal.seoTitle,
            seoDescription: proposal.seoDescription,
            origin: "ai",
          },
        });
      }
      toast.success("Fix applied");
      setProposal(null);
    } catch (e) {
      toast.error("Apply failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div className="rounded-md border p-3">
      {!proposal ? (
        <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Generate proposal
        </Button>
      ) : (
        <div className="grid gap-2">
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-background p-2 font-mono text-caption">
            {[
              proposal.description,
              proposal.alt,
              proposal.seoTitle,
              proposal.seoDescription,
            ]
              .filter(Boolean)
              .join("\n\n")}
          </pre>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setProposal(null)}>
              Discard
            </Button>
            <Button size="sm" onClick={apply}>
              Apply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Product inspector ─────────────────────────────────────────────────── */

function ProductInspector({
  product,
  projectId,
  onClose,
}: {
  product: ProductBundle;
  projectId: Id<"projects">;
  onClose: () => void;
}) {
  const update = useMutation(api.products.update);
  const updateDefault = useMutation(api.variants.updateDefault);
  const remove = useMutation(api.products.remove);

  const def = product.variants.find((v) => v.isDefault);
  const [price, setPrice] = useState(
    def?.priceCents != null ? (def.priceCents / 100).toString() : "",
  );
  const [stock, setStock] = useState(def?.inventoryCount?.toString() ?? "");
  const [sku, setSku] = useState(def?.sku ?? "");
  const [gtin, setGtin] = useState(def?.gtin ?? "");
  const [desc, setDesc] = useState(product.description ?? "");
  const [saving, setSaving] = useState(false);

  const saveFacts = async () => {
    setSaving(true);
    try {
      const patch: Record<string, unknown> = {};
      if (price !== "" && Number.isFinite(parseFloat(price)))
        patch.priceCents = Math.round(parseFloat(price) * 100);
      if (stock !== "") patch.inventoryCount = parseInt(stock, 10);
      if (sku !== (def?.sku ?? "")) patch.sku = sku || undefined;
      if (gtin !== (def?.gtin ?? "")) patch.gtin = gtin || undefined;
      if (Object.keys(patch).length) {
        await updateDefault({ productId: product._id, ...patch });
      }
      if (desc !== (product.description ?? "")) {
        await update({ id: product._id, description: desc || undefined });
      }
      toast.success("Product updated");
    } catch (e) {
      toast.error("Update failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const aiIssues = product.readiness.issues.filter(
    (i) => i.fixType === "ai_safe",
  );
  const inputIssues = product.readiness.issues.filter(
    (i) => i.fixType === "user_input",
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l bg-background p-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-mono text-h3">{product.title}</p>
            <div className="mt-1 flex items-center gap-2">
              <StatusBadge status={product.status ?? "draft"} />
              <span
                className={cn(
                  "font-mono text-caption",
                  READY_TONE[product.readiness.state],
                )}
              >
                {product.readiness.state.replace(/_/g, " ")}
              </span>
            </div>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-3.5" />
          </Button>
        </div>

        {/* Editable facts — commerce facts live on the (default) variant */}
        <div className="mt-5 grid gap-3 rounded-md border bg-card p-4">
          <p className="font-mono text-caption text-muted-foreground">facts</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="i-price">Price</Label>
              <Input
                id="i-price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="i-stock">Stock</Label>
              <Input
                id="i-stock"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="i-sku">SKU</Label>
              <Input
                id="i-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="i-gtin">GTIN / barcode</Label>
              <Input
                id="i-gtin"
                value={gtin}
                onChange={(e) => setGtin(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="i-desc">Description</Label>
            <Textarea
              id="i-desc"
              rows={4}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={saveFacts} disabled={saving}>
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              Save
            </Button>
          </div>
        </div>

        {/* Required fixes — user input (deterministic readiness) */}
        {inputIssues.length > 0 && (
          <div className="mt-4 grid gap-2">
            <p className="font-mono text-caption text-muted-foreground">
              needs your input
            </p>
            {inputIssues.map((i) => (
              <div key={i.field + i.objectId} className="rounded-md border p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-terminal-amber" />
                  <p className="font-mono text-caption">{i.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AI-safe fixes — proposal flow */}
        {aiIssues.length > 0 && (
          <div className="mt-4 grid gap-3">
            <p className="font-mono text-caption text-muted-foreground">
              MOSAI can help
            </p>
            {aiIssues.map((i) => (
              <div key={i.field + i.objectId} className="grid gap-2">
                <div className="rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-terminal-green" />
                    <p className="font-mono text-caption">{i.message}</p>
                  </div>
                </div>
                <AiFixCard
                  issue={i}
                  product={product}
                  projectId={projectId}
                />
              </div>
            ))}
          </div>
        )}

        {/* Recommendations — advisory, never blocking */}
        {product.readiness.recommendations.length > 0 && (
          <div className="mt-4 grid gap-1.5">
            <p className="font-mono text-caption text-muted-foreground">
              recommendations
            </p>
            {product.readiness.recommendations.map((r) => (
              <p
                key={r.field}
                className="font-mono text-caption text-muted-foreground"
              >
                · {r.message}
              </p>
            ))}
          </div>
        )}

        <div className="mt-auto pt-6">
          <ConfirmDelete
            what={`"${product.title}"`}
            onConfirm={async () => {
              await remove({ id: product._id });
              toast.success("Product deleted");
              onClose();
            }}
            trigger={
              <Button variant="outline" className="text-destructive">
                <Trash2 className="size-4" /> Delete product
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}

/* ── Products tab ──────────────────────────────────────────────────────── */

function ProductsTab({ projectId }: { projectId: Id<"projects"> }) {
  const products = useQuery(api.products.listWithReadiness, { projectId });
  const [selected, setSelected] = useState<Id<"products"> | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const summary = useMemo(() => {
    const list = products ?? [];
    return {
      ready: list.filter((p) => p.readiness.state === "ready").length,
      attention: list.filter((p) => p.readiness.state === "needs_attention")
        .length,
      blocked: list.filter((p) => p.readiness.state === "blocked").length,
    };
  }, [products]);

  if (products === undefined) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div>
        <ModuleEmpty
          icon={ShoppingBag}
          title="No products yet"
          hint="Add products to make them available across your website, content and campaigns."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4" /> Add product
            </Button>
          }
        />
        <AddProductDialog
          projectId={projectId}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="font-mono text-caption text-terminal-green">
          {summary.ready} ready
        </span>
        <span className="font-mono text-caption text-terminal-amber">
          {summary.attention} need attention
        </span>
        <span className="font-mono text-caption text-terminal-red">
          {summary.blocked} blocked
        </span>
        <Button size="sm" className="ml-auto" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add product
        </Button>
      </div>

      <div className="grid gap-2">
        {products.map((p) => {
          const primary = p.media.find((m) => !m.variantId);
          const def = p.variants.find((v) => v.isDefault);
          return (
            <button
              key={p._id}
              onClick={() => setSelected(p._id)}
              className="cursor-pointer rounded-md border bg-card p-3 text-left shadow-card ease-terminal hover:border-terminal-green/40"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-background">
                  {primary?.url ? (
                    <img
                      src={primary.url}
                      alt={primary.alt ?? p.title}
                      className="size-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="size-4 text-muted-foreground" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-small font-medium">
                    {p.title}
                  </p>
                  <p className="font-mono text-caption text-muted-foreground">
                    {def?.priceCents != null
                      ? `${(def.priceCents / 100).toFixed(2)} ${def.currency}`
                      : "no price"}
                    {def?.inventoryCount != null
                      ? ` · ${def.inventoryCount} in stock`
                      : ""}
                    {p.collectionIds?.length
                      ? ` · ${p.collectionIds.length} collection${p.collectionIds.length > 1 ? "s" : ""}`
                      : ""}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-mono text-caption",
                    READY_TONE[p.readiness.state],
                  )}
                >
                  {p.readiness.state === "ready" ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    p.readiness.state.replace(/_/g, " ")
                  )}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <AddProductDialog
        projectId={projectId}
        open={addOpen}
        onOpenChange={setAddOpen}
      />

      {selected &&
        (() => {
          const p = products.find((x) => x._id === selected);
          if (!p) return null;
          return (
            <ProductInspector
              product={p as ProductBundle}
              projectId={projectId}
              onClose={() => setSelected(null)}
            />
          );
        })()}
    </div>
  );
}

/* ── Collections tab ───────────────────────────────────────────────────── */

function CollectionsTab({ projectId }: { projectId: Id<"projects"> }) {
  const collections = useQuery(api.collections.list, { projectId }) ?? [];
  const products = useQuery(api.products.listWithReadiness, { projectId }) ?? [];
  const create = useMutation(api.collections.create);
  const update = useMutation(api.products.update);
  const removeCollection = useMutation(api.collections.remove);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const productsIn = (cid: Id<"collections">) =>
    products.filter((p) => p.collectionIds?.includes(cid));

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await create({ projectId, title: title.trim() });
      setTitle("");
      toast.success("Collection created");
    } catch (e) {
      toast.error("Create failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const addToCollection = async (
    productId: Id<"products">,
    cid: Id<"collections">,
    current: Id<"collections">[] | undefined,
  ) => {
    try {
      await update({
        id: productId,
        collectionIds: current ? [...current, cid] : [cid],
      });
      toast.success("Added to collection");
    } catch (e) {
      toast.error("Failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New collection name…"
          className="max-w-xs"
        />
        <Button onClick={add} disabled={busy || !title.trim()}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FolderPlus className="size-4" />
          )}
          Create
        </Button>
      </div>

      {collections.length === 0 ? (
        <ModuleEmpty
          icon={FolderPlus}
          title="No collections"
          hint="Collections group products for your website, campaigns and feed grouping."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {collections.map((c) => {
            const inside = productsIn(c._id);
            const outside = products.filter(
              (p) => !p.collectionIds?.includes(c._id),
            );
            return (
              <div
                key={c._id}
                className="rounded-md border bg-card p-4 shadow-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-small font-medium">{c.title}</p>
                  <ConfirmDelete
                    what={`collection "${c.title}"`}
                    onConfirm={async () => {
                      await removeCollection({ id: c._id });
                      toast.success("Collection deleted");
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
                <p className="mt-1 font-mono text-caption text-muted-foreground">
                  {inside.length} product{inside.length === 1 ? "" : "s"}
                </p>
                {inside.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {inside.map((p) => (
                      <Badge
                        key={p._id}
                        variant="outline"
                        className="font-mono text-caption"
                      >
                        {p.title}
                      </Badge>
                    ))}
                  </div>
                )}
                {outside.length > 0 && (
                  <div className="mt-3 border-t pt-2">
                    <p className="mb-1.5 font-mono text-caption text-muted-foreground">
                      add product
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {outside.slice(0, 6).map((p) => (
                        <button
                          key={p._id}
                          onClick={() =>
                            void addToCollection(p._id, c._id, p.collectionIds)
                          }
                          className="cursor-pointer rounded-full border px-2 py-0.5 font-mono text-caption text-muted-foreground ease-terminal hover:text-terminal-green"
                        >
                          + {p.title}
                        </button>
                      ))}
                    </div>
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

/* ── Feed tab ──────────────────────────────────────────────────────────── */

function FeedTab({ projectId }: { projectId: Id<"projects"> }) {
  const feed = useQuery(api.sell.queries.feedStatus, { projectId });

  if (feed === undefined) {
    return (
      <div className="grid place-items-center py-16">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!feed) {
    return (
      <ModuleEmpty
        icon={AlertTriangle}
        title="Feed unavailable"
        hint="Could not load the catalog feed."
      />
    );
  }

  const stateLabel =
    feed.state === "ready"
      ? "Ready to connect"
      : feed.state === "needs_attention"
        ? "Needs attention"
        : "Not configured";

  const download = () => {
    const blob = new Blob([feed.xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "google-merchant-feed.xml";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card">
        <div className="flex-1">
          <p className="font-mono text-small font-medium">
            Google Merchant feed
          </p>
          <p className="mt-0.5 font-mono text-caption text-muted-foreground">
            {feed.itemCount} item{feed.itemCount === 1 ? "" : "s"} projected ·{" "}
            {stateLabel}
          </p>
        </div>
        <Button onClick={download} disabled={feed.itemCount === 0}>
          <Download className="size-4" /> Download XML
        </Button>
      </div>

      {feed.issues.length > 0 ? (
        <div className="grid gap-2">
          <p className="font-mono text-caption text-muted-foreground">
            {feed.issues.length} issue{feed.issues.length === 1 ? "" : "s"}
          </p>
          {feed.issues.map((i, idx) => (
            <div key={idx} className="rounded-md border p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-terminal-amber" />
                <p className="font-mono text-caption">
                  {i.variantLabel ? `${i.variantLabel}: ` : ""}
                  {i.message}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-terminal-green/40 bg-terminal-green-soft p-4 text-center">
          <p className="font-mono text-caption text-terminal-green">
            Everything looks good — the catalog is channel-ready.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Storefront tab: W5 live preview of the public shop ────────────────── */

function StorefrontTab({ projectId }: { projectId: Id<"projects"> }) {
  const shopProducts = useQuery(api.storefront.listShopProducts, {
    projectId,
    search: "",
    availability: "all",
    sort: "featured",
  });
  const shopCollections = useQuery(api.storefront.listShopCollections, { projectId });
  const site = useQuery(api.cms.getSite, { projectId });
  const sync = useAction(api.shopifySync.syncCatalog);
  const [syncing, setSyncing] = useState(false);

  const productCount = shopProducts?.length ?? 0;
  const inStock =
    shopProducts?.filter((p) => p.availability !== "out_of_stock").length ?? 0;
  const externalCount =
    shopProducts?.filter((p) => p.provider != null).length ?? 0;
  const hasSyncedBefore = externalCount > 0;

  const runSync = async () => {
    setSyncing(true);
    try {
      const res = await sync({ projectId });
      toast.success(
        `Synced ${res.products} products, ${res.collections} collections`,
      );
    } catch (e) {
      toast.error("Sync failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="grid gap-4">
      {/* health strip */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "products", value: productCount },
          { label: "in stock", value: inStock },
          { label: "collections", value: shopCollections?.length ?? 0 },
          { label: "from shopify", value: externalCount },
        ].map((s) => (
          <div key={s.label} className="rounded-md border bg-card p-3 shadow-card">
            <p className="font-mono text-h2 font-semibold">{s.value}</p>
            <p className="font-mono text-caption text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-4 shadow-card">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-small font-medium">Storefront</p>
          <p className="font-mono text-caption text-muted-foreground">
            {site
              ? "Your published site serves the shop — browse, product pages and checkout handoff."
              : "Create a site in Build first — the storefront renders it."}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void runSync()}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Sync Shopify
        </Button>
        {site && (
          <Button asChild>
            <a href={`/shop/${projectId}`} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" /> Open storefront
            </a>
          </Button>
        )}
      </div>

      {/* capability matrix — honest, per CMS-CONNECTOR-CONTRACT.md */}
      <div className="rounded-md border bg-card p-4 shadow-card">
        <p className="font-mono text-caption text-muted-foreground">
          connector capability — shopify (read mode)
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {[
            { label: "browse", ok: true },
            { label: "product pages", ok: true },
            { label: "checkout via shopify", ok: true },
            { label: "native orders", ok: false },
            { label: "refunds", ok: false },
          ].map((c) => (
            <Badge
              key={c.label}
              variant="outline"
              className={cn(
                "font-mono text-caption",
                c.ok ? "text-terminal-green" : "text-muted-foreground",
              )}
            >
              {c.ok ? "✓" : "✗"} {c.label}
            </Badge>
          ))}
        </div>
        {!hasSyncedBefore && (
          <p className="mt-3 rounded-md border border-terminal-amber/40 bg-terminal-amber-soft px-3 py-2 font-mono text-caption text-terminal-amber">
            No external products yet — add SHOPIFY_STORE_DOMAIN and
            SHOPIFY_STOREFRONT_ACCESS_TOKEN in the Keys tab, then sync.
          </p>
        )}
        {productCount === 0 && (
          <p className="mt-3 font-mono text-caption text-muted-foreground">
            No products visible yet — sync Shopify or activate products on the
            Products tab.
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────── */

export default function Sell({ projectId }: { projectId: Id<"projects"> }) {
  return (
    <div>
      <ModuleHeader
        icon={ShoppingBag}
        title="Sell"
        subtitle="Products, readiness and channel feeds — the commerce brain behind every MOSAI module"
      >
        <BrandUseChip projectId={projectId} use="shop" />
      </ModuleHeader>

      <Tabs defaultValue="products">
        <TabsList>
          <TabsTrigger value="products" className="cursor-pointer">
            Products
          </TabsTrigger>
          <TabsTrigger value="collections" className="cursor-pointer">
            Collections
          </TabsTrigger>
          <TabsTrigger value="storefront" className="cursor-pointer">
            Storefront
          </TabsTrigger>
          <TabsTrigger value="feed" className="cursor-pointer">
            Feed
          </TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-4">
          <ProductsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="collections" className="mt-4">
          <CollectionsTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="storefront" className="mt-4">
          <StorefrontTab projectId={projectId} />
        </TabsContent>
        <TabsContent value="feed" className="mt-4">
          <FeedTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
