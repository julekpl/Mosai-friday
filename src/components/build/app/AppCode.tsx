import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { FileCode2, Loader2, Save } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AppFile } from "@/shared/appBuilder/source";

/** File list plus a plain editor. A save writes a new version, so chat
 *  edits and hand edits share one history; a stale base is refused. */
export function AppCode({ buildId, version, files }: { buildId: Id<"builds">; version: number; files: AppFile[] }) {
  const saveFile = useMutation(api.modules.buildApp.workspace.saveFile);
  const [selected, setSelected] = useState(files.find((file) => file.path === "src/App.jsx")?.path ?? files[0]?.path ?? "");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const file = files.find((item) => item.path === selected) ?? files[0];
  if (!file) return <p className="font-mono text-caption text-muted-foreground">No files yet.</p>;
  const value = drafts[file.path] ?? file.content;
  const dirty = value !== file.content;

  const save = async () => {
    setSaving(true);
    try {
      await saveFile({ buildId, baseVersion: version, path: file.path, content: value });
      setDrafts((current) => {
        const next = { ...current };
        delete next[file.path];
        return next;
      });
      toast.success(`Saved ${file.path}`, { description: "Saved as a new version. The preview reloads." });
    } catch (error) {
      toast.error("Could not save the file", { description: error instanceof Error ? error.message : "Try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <nav aria-label="App files" className="max-h-96 overflow-y-auto rounded-md border bg-card p-1 md:max-h-none">
        <ul className="grid gap-0.5">
          {files.map((item) => (
            <li key={item.path}>
              <button
                type="button"
                onClick={() => setSelected(item.path)}
                aria-current={item.path === file.path ? "true" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left font-mono text-caption hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  item.path === file.path && "bg-accent text-foreground",
                )}
              >
                <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{item.path.replace(/^src\//, "")}</span>
                {drafts[item.path] !== undefined && drafts[item.path] !== item.content ? <span className="sr-only">(unsaved)</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-caption text-muted-foreground">{file.path}</p>
          <Button size="sm" variant="outline" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save file
          </Button>
        </div>
        <Textarea
          aria-label={`Source of ${file.path}`}
          spellCheck={false}
          value={value}
          onChange={(event) => setDrafts((current) => ({ ...current, [file.path]: event.target.value }))}
          className="min-h-96 font-mono text-caption leading-relaxed"
        />
      </div>
    </div>
  );
}
