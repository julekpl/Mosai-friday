import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Plus, ShoppingBag, Trash2 } from "lucide-react";

import { ModuleHeader } from "@/components/app/AppShell";
import { ConfirmDelete, ModuleEmpty } from "@/components/app/module-kit";
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
import { Badge } from "@/components/ui/badge";

function ProductForm({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const create = useMutation(api.products.create);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setIsSaving(true);
    try {
      const priceCents = price ? Math.round(parseFloat(price) * 100) : undefined;
      await create({
        projectId,
        title: title.trim(),
        priceCents: Number.isFinite(priceCents as number) ? priceCents : undefined,
        feedUrl: feedUrl.trim() || undefined,
      });
      toast.success("Product added");
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
        <Label htmlFor="pr-title">Product title</Label>
        <Input
          id="pr-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Office blend 250g"
          autoFocus
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="pr-price">Price (€)</Label>
          <Input
            id="pr-price"
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="pr-feed">Product feed URL</Label>
          <Input
            id="pr-feed"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="https://…/feed.xml"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button onClick={handleSave} disabled={isSaving || !title.trim()}>
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Add product
        </Button>
      </div>
    </div>
  );
}

export default function Sell({ projectId }: { projectId: Id<"projects"> }) {
  const products = useQuery(api.products.list, { projectId }) ?? [];
  const remove = useMutation(api.products.remove);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <ModuleHeader
        icon={ShoppingBag}
        title="Sell"
        subtitle="Products and product feeds — commerce primitives, billing later"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add product
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">New product</DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Products flow into ads (Merchant Center) and the website
                builder's commerce blocks.
              </DialogDescription>
            </DialogHeader>
            <ProductForm projectId={projectId} onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </ModuleHeader>

      {products.length === 0 ? (
        <ModuleEmpty
          icon={ShoppingBag}
          title="No products yet"
          hint="Add products with optional feed URLs. Feeds power Google Merchant Center, Meta catalog and the website builder's commerce sections."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Add the first product
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {products.map((p) => (
            <div key={p._id} className="rounded-md border bg-card p-4 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-mono text-small font-medium">{p.title}</p>
                  <p className="mt-0.5 font-mono text-caption text-muted-foreground">
                    {p.priceCents != null
                      ? `€${(p.priceCents / 100).toFixed(2)}`
                      : "no price"}
                    {p.feedUrl ? " · feed linked" : ""}
                  </p>
                </div>
                <ConfirmDelete
                  what={`"${p.title}"`}
                  onConfirm={async () => {
                    await remove({ id: p._id });
                    toast.success("Product deleted");
                  }}
                  trigger={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${p.title}`}
                      className="shrink-0 text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  }
                />
              </div>
              {p.feedUrl && (
                <Badge
                  variant="outline"
                  className="mt-3 font-mono text-caption text-muted-foreground"
                >
                  feed: {p.feedUrl}
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
