import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Archive,
  ExternalLink,
  FileText,
  Globe,
  Home,
  Image as ImageIcon,
  Link2,
  Plus,
  Rocket,
  Settings,
  ShoppingBag,
  Trash2,
} from "lucide-react";

import { PageEditor } from "./PageEditor";
import { PublishToWeb } from "@/components/build/PublishToWeb";
import {
  isReleasePrepared,
  pageStatusForDisplay,
  siteStatusForDisplay,
  statusText,
} from "./releaseLabels";
import { ModuleEmpty } from "@/components/app/module-kit";
import { StatusBadge } from "@/components/app/module-kit";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SiteDoc = Doc<"sites">;
type PageDoc = Doc<"cmsPages">;

export function SitePanel({
  projectId,
  site,
}: {
  projectId: Id<"projects">;
  site: SiteDoc;
}) {
  return (
    <div className="grid gap-4">
      {/* Puts the pages' prepared releases on the web at /s/<slug>-website. */}
      <PublishToWeb projectId={projectId} compact />
      <Tabs defaultValue="pages" className="gap-4">
      <TabsList>
        <TabsTrigger value="pages" className="font-mono text-caption">
          <FileText className="mr-1.5 size-3.5" /> Pages
        </TabsTrigger>
        <TabsTrigger value="navigation" className="font-mono text-caption">
          <Link2 className="mr-1.5 size-3.5" /> Navigation
        </TabsTrigger>
        <TabsTrigger value="assets" className="font-mono text-caption">
          <ImageIcon className="mr-1.5 size-3.5" /> Assets
        </TabsTrigger>
        <TabsTrigger value="redirects" className="font-mono text-caption">
          <ExternalLink className="mr-1.5 size-3.5" /> Redirects
        </TabsTrigger>
        <TabsTrigger value="settings" className="font-mono text-caption">
          <Settings className="mr-1.5 size-3.5" /> Settings
        </TabsTrigger>
      </TabsList>
      <TabsContent value="pages">
        <PagesTab site={site} />
      </TabsContent>
      <TabsContent value="navigation">
        <NavigationTab site={site} />
      </TabsContent>
      <TabsContent value="assets">
        <AssetsTab projectId={projectId} />
      </TabsContent>
      <TabsContent value="redirects">
        <RedirectsTab site={site} />
      </TabsContent>
      <TabsContent value="settings">
        <SettingsTab site={site} />
      </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Pages ─────────────────────────────────────────────────────────────── */

function PagesTab({ site }: { site: SiteDoc }) {
  const pages = (useQuery(api.cms.listPages, { siteId: site._id }) ?? []) as PageDoc[];
  const createPage = useMutation(api.cms.createPage);
  const archive = useMutation(api.cms.archivePage);
  const del = useMutation(api.cms.deletePage);
  const setHomepage = useMutation(api.cms.updatePage);

  const [editingId, setEditingId] = useState<Id<"cmsPages"> | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState<string>("");

  const editing = pages.find((p) => p._id === editingId) ?? null;

  if (editing) {
    return <PageEditor page={editing} onBack={() => setEditingId(null)} />;
  }

  const sorted = [...pages].sort((a, b) => a.fullPath.localeCompare(b.fullPath));

  const handleCreate = async () => {
    try {
      const id = await createPage({
        siteId: site._id,
        title: title.trim() || slug,
        slug: slug.trim() || title,
        parentId: parentId ? (parentId as Id<"cmsPages">) : undefined,
      });
      toast.success("Page created", { description: "It starts as a draft." });
      setOpen(false);
      setTitle("");
      setSlug("");
      setParentId("");
      setEditingId(id);
    } catch (e) {
      toast.error("Create failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" /> New page
        </Button>
      </div>

      {sorted.map((p) => (
        <div
          key={p._id}
          className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-4 shadow-card"
        >
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer text-left"
            onClick={() => setEditingId(p._id)}
          >
            <p className="flex items-center gap-1.5 font-mono text-small font-medium">
              {(p.pageType === "homepage" || site.homepageId === p._id) && (
                <Home className="size-3.5 text-terminal-green" />
              )}
              {p.title}
            </p>
            <p className="truncate font-mono text-caption text-muted-foreground">
              {p.fullPath}
              {isReleasePrepared(p.status) && p.latestDraftRevisionId
                ? " · draft changes since the prepared release"
                : ""}
            </p>
          </button>
          {site.homepageId === p._id && (
            <Badge
              variant="outline"
              className="font-mono text-caption text-terminal-green"
            >
              homepage
            </Badge>
          )}
          <StatusBadge status={pageStatusForDisplay(p.status)} />
          {!isReleasePrepared(p.status) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void setHomepage({ id: p._id, setHomepage: true }).then(() =>
                  toast.success(`${p.title} is now the homepage`),
                )
              }
            >
              <Home className="size-3.5" /> Set homepage
            </Button>
          )}
          {p.status !== "archived" && p.pageType !== "homepage" && site.homepageId !== p._id && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Archive ${p.title}`}
              onClick={() =>
                void archive({ id: p._id })
                  .then(() => toast.success("Page archived"))
                  .catch((e: unknown) =>
                    toast.error("Archive failed", {
                      description: e instanceof Error ? e.message : "Try again.",
                    }),
                  )
              }
            >
              <Archive className="size-3.5" />
            </Button>
          )}
          {p.status === "archived" && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Delete ${p.title}`}
              className="text-destructive"
              onClick={() =>
                void del({ id: p._id })
                  .then(() => toast.success("Page deleted"))
                  .catch((e: unknown) =>
                    toast.error("Delete failed", {
                      description: e instanceof Error ? e.message : "Try again.",
                    }),
                  )
              }
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      ))}

      <NewPageDialog
        open={open}
        onOpenChange={setOpen}
        pages={sorted}
        title={title}
        slug={slug}
        parentId={parentId}
        setTitle={setTitle}
        setSlug={setSlug}
        setParentId={setParentId}
        onCreate={handleCreate}
      />
    </div>
  );
}

function NewPageDialog({
  open,
  onOpenChange,
  pages,
  title,
  slug,
  parentId,
  setTitle,
  setSlug,
  setParentId,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  pages: PageDoc[];
  title: string;
  slug: string;
  parentId: string;
  setTitle: (v: string) => void;
  setSlug: (v: string) => void;
  setParentId: (v: string) => void;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-h3">New page</DialogTitle>
          <DialogDescription className="font-mono text-caption">
            Slugs are normalized and must be unique within the site.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Services"
              autoFocus
            />
          </div>
          <div className="grid gap-1">
            <Label>Slug</Label>
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="services"
            />
          </div>
          <div className="grid gap-1">
            <Label>Parent page</Label>
            <select
              className="h-9 cursor-pointer rounded-md border bg-card px-3 font-mono text-small"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">— top level —</option>
              {pages
                .filter((p) => p.status !== "archived")
                .map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.fullPath === "/" ? "Home (root)" : p.fullPath}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onCreate} disabled={!title.trim() && !slug.trim()}>
              Create page
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Navigation ────────────────────────────────────────────────────────── */

function NavigationTab({ site }: { site: SiteDoc }) {
  const navs = useQuery(api.cms.listNavigations, { siteId: site._id }) ?? [];
  const pages = (useQuery(api.cms.listPages, { siteId: site._id }) ?? []) as PageDoc[];
  const save = useMutation(api.cms.saveNavigation);

  const main = navs.find((n) => n.name === "Main");
  const [items, setItems] = useState<
    { id: string; label: string; type: string; referenceId?: string; url?: string }[]
  >(main?.items ?? []);
  const [loadedFor, setLoadedFor] = useState<string | null>(main?._id ?? null);
  const [saving, setSaving] = useState(false);

  if (main && loadedFor !== main._id) {
    setItems(main.items);
    setLoadedFor(main._id);
  }

  const addItem = (type: "page" | "external") => {
    setItems((cur) => [
      ...cur,
      {
        id: `itm_${Math.random().toString(36).slice(2, 10)}`,
        label: "",
        type,
      },
    ]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        siteId: site._id,
        name: "Main",
        items: items.map((it) => ({
          ...it,
          label: it.label || "Untitled",
          referenceId: it.referenceId as Id<"cmsPages"> | undefined,
        })),
      });
      toast.success("Navigation saved");
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3">
      {items.map((item, i) => (
        <div
          key={item.id}
          className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 shadow-card"
        >
          <Input
            className="w-40"
            value={item.label}
            placeholder="Label"
            onChange={(e) =>
              setItems((cur) =>
                cur.map((it, j) =>
                  j === i ? { ...it, label: e.target.value } : it,
                ),
              )
            }
          />
          {item.type === "page" ? (
            <select
              className="h-9 flex-1 cursor-pointer rounded-md border bg-card px-3 font-mono text-small"
              value={item.referenceId ?? ""}
              onChange={(e) =>
                setItems((cur) =>
                  cur.map((it, j) =>
                    j === i ? { ...it, referenceId: e.target.value || undefined } : it,
                  ),
                )
              }
            >
              <option value="">— choose page —</option>
              {pages.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.fullPath === "/" ? "Home" : p.fullPath}
                </option>
              ))}
            </select>
          ) : (
            <Input
              className="flex-1"
              value={item.url ?? ""}
              placeholder="https://…"
              onChange={(e) =>
                setItems((cur) =>
                  cur.map((it, j) =>
                    j === i ? { ...it, url: e.target.value } : it,
                  ),
                )
              }
            />
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Remove item"
            className="text-destructive"
            onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => addItem("page")}>
          <Plus className="size-3.5" /> Page link
        </Button>
        <Button size="sm" variant="outline" onClick={() => addItem("external")}>
          <Plus className="size-3.5" /> External link
        </Button>
        <Button
          size="sm"
          className="ml-auto"
          onClick={handleSave}
          disabled={saving}
        >
          Save navigation
        </Button>
      </div>
    </div>
  );
}

/* ── Assets ────────────────────────────────────────────────────────────── */

function AssetsTab({ projectId }: { projectId: Id<"projects"> }) {
  const assets = useQuery(api.cms.listAssets, { projectId }) ?? [];
  const create = useMutation(api.cms.createAsset);
  const del = useMutation(api.cms.deleteAsset);
  const update = useMutation(api.cms.updateAsset);

  const [url, setUrl] = useState("");
  const [filename, setFilename] = useState("");
  const [altText, setAltText] = useState("");

  const handleAdd = async () => {
    try {
      await create({
        projectId,
        type: "image",
        filename: filename.trim() || url.split("/").pop() || "image",
        url: url.trim(),
        altText: altText.trim() || undefined,
        source: "external",
      });
      toast.success("Asset added");
      setUrl("");
      setFilename("");
      setAltText("");
    } catch (e) {
      toast.error("Add failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-md border bg-card p-4 shadow-card">
        <p className="font-mono text-caption text-muted-foreground">
          add image asset
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… image URL"
          />
          <Input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="filename (optional)"
          />
          <Input
            value={altText}
            onChange={(e) => setAltText(e.target.value)}
            placeholder="alt text (accessibility)"
          />
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={handleAdd} disabled={!url.trim()}>
            <Plus className="size-3.5" /> Add asset
          </Button>
        </div>
      </div>

      {assets.length === 0 ? (
        <ModuleEmpty
          icon={ImageIcon}
          title="No assets yet"
          hint="Assets are canonical references — pages reference them by stable ID, so a swap here updates every page that uses them."
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a) => (
            <div
              key={a._id}
              className="grid gap-2 rounded-md border bg-card p-3 shadow-card"
            >
              <img
                src={a.url}
                alt={a.altText ?? ""}
                className="h-28 w-full rounded border object-cover"
              />
              <p className="truncate font-mono text-caption">{a.filename}</p>
              <Input
                defaultValue={a.altText ?? ""}
                placeholder="alt text"
                onBlur={(e) =>
                  void update({ id: a._id, altText: e.target.value || undefined })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() =>
                  void del({ id: a._id })
                    .then(() => toast.success("Asset deleted"))
                    .catch((e: unknown) =>
                      toast.error("Cannot delete", {
                        description: e instanceof Error ? e.message : "Try again.",
                      }),
                    )
                }
              >
                <Trash2 className="size-3" /> Delete
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Redirects ─────────────────────────────────────────────────────────── */

function RedirectsTab({ site }: { site: SiteDoc }) {
  const redirects = useQuery(api.cms.listRedirects, { siteId: site._id }) ?? [];
  const create = useMutation(api.cms.createRedirect);
  const del = useMutation(api.cms.deleteRedirect);

  const [fromPath, setFromPath] = useState("");
  const [to, setTo] = useState("");

  const handleAdd = async () => {
    try {
      await create({
        siteId: site._id,
        fromPath,
        to,
        statusCode: 301,
      });
      toast.success("Redirect created");
      setFromPath("");
      setTo("");
    } catch (e) {
      toast.error("Create failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 rounded-md border bg-card p-4 shadow-card">
        <p className="font-mono text-caption text-muted-foreground">
          new redirect (301)
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={fromPath}
            onChange={(e) => setFromPath(e.target.value)}
            placeholder="/old-path"
          />
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="/new-path"
          />
          <Button size="sm" onClick={handleAdd} disabled={!fromPath || !to}>
            <Plus className="size-3.5" /> Add
          </Button>
        </div>
        <p className="font-mono text-caption text-muted-foreground">
          Redirects are also created automatically when a published page's path
          changes.
        </p>
      </div>

      {redirects.length === 0 ? (
        <ModuleEmpty
          icon={ExternalLink}
          title="No redirects"
          hint="When you change a published page's URL, a 301 is created here automatically so old links keep working."
        />
      ) : (
        <div className="grid gap-2">
          {redirects.map((r) => (
            <div
              key={r._id}
              className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 shadow-card"
            >
              <Badge
                variant="outline"
                className="font-mono text-caption text-muted-foreground"
              >
                {r.statusCode}
              </Badge>
              <p className="font-mono text-small">
                {r.fromPath} <span className="text-muted-foreground">→</span> {r.to}
              </p>
              {r.source === "auto_path_change" && (
                <Badge
                  variant="outline"
                  className="font-mono text-caption text-terminal-blue"
                >
                  auto
                </Badge>
              )}
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Delete redirect"
                className="ml-auto text-destructive"
                onClick={() => void del({ id: r._id })}
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

/* ── Settings ──────────────────────────────────────────────────────────── */

function SettingsTab({ site }: { site: SiteDoc }) {
  const update = useMutation(api.cms.updateSite);
  const [name, setName] = useState(site.name);
  const [siteName, setSiteName] = useState(site.seoDefaults?.siteName ?? "");
  const [titleTemplate, setTitleTemplate] = useState(
    site.seoDefaults?.titleTemplate ?? "",
  );
  const [metaDescription, setMetaDescription] = useState(
    site.seoDefaults?.metaDescription ?? "",
  );

  const handleSave = async () => {
    try {
      await update({
        id: site._id,
        name: name.trim() || site.name,
        seoDefaults: {
          siteName: siteName.trim() || undefined,
          titleTemplate: titleTemplate.trim() || undefined,
          metaDescription: metaDescription.trim() || undefined,
          socialImageUrl: site.seoDefaults?.socialImageUrl,
        },
      });
      toast.success("Site settings saved");
    } catch (e) {
      toast.error("Save failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div className="grid max-w-xl gap-4">
      <div className="grid gap-2 rounded-md border bg-card p-4 shadow-card">
        <p className="font-mono text-caption text-muted-foreground">site</p>
        <div className="grid gap-1">
          <Label>Site name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground">
          <Globe className="size-3.5" /> status:{" "}
          {statusText(siteStatusForDisplay(site.status ?? "draft"))} · whether
          the site is on the web is shown by “Publish to web” above. Custom
          domains arrive later
        </p>
        <a
          href={`/shop/${site.projectId}`}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex w-fit items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-caption transition-colors ease-terminal hover:bg-accent"
        >
          <ShoppingBag className="size-3.5" /> Open storefront
          <ExternalLink className="size-3" />
        </a>
        <p className="font-mono text-caption text-muted-foreground">
          /shop is a signed-in preview of the storefront (pages, shop listing,
          collections and products). It is not a public link yet.
        </p>
      </div>
      <div className="grid gap-2 rounded-md border bg-card p-4 shadow-card">
        <p className="font-mono text-caption text-muted-foreground">
          seo defaults
        </p>
        <div className="grid gap-1">
          <Label>Site name (structured data)</Label>
          <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label>Title template</Label>
          <Input
            value={titleTemplate}
            onChange={(e) => setTitleTemplate(e.target.value)}
            placeholder="%s · My Brand"
          />
        </div>
        <div className="grid gap-1">
          <Label>Default meta description</Label>
          <Textarea
            rows={3}
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSave}>
          <Rocket className="size-4" /> Save settings
        </Button>
      </div>
    </div>
  );
}
