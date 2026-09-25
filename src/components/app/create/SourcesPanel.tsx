import { useId, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  BookOpen,
  ChevronDown,
  ClipboardPaste,
  Download,
  FileText,
  Globe,
  Link2,
  Loader2,
  StickyNote,
  Trash2,
  Upload,
  Youtube,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { cn } from "@/lib/utils";

/* ── Source library for one content piece ─────────────────────────────────
 *
 * Everything the AI may write from, with a per-source "include" switch:
 * uploaded files (PDF, DOCX, TXT, MD, CSV, HTML, subtitles…), web pages,
 * YouTube transcripts, full text of research findings, and pasted notes.
 * Full text is stored on the server; this panel shows metadata + a preview.
 */

export const SOURCE_FILE_ACCEPT =
  ".txt,.md,.markdown,.csv,.tsv,.json,.xml,.yaml,.yml,.html,.htm,.srt,.vtt,.pdf,.docx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

type Finding = { source: string; title: string; url?: string; snippet?: string };

const KIND_ICON = {
  file: FileText,
  web: Globe,
  youtube: Youtube,
  research: BookOpen,
  note: StickyNote,
} as const;

const KIND_LABEL = {
  file: "file",
  web: "web page",
  youtube: "YouTube transcript",
  research: "research",
  note: "note",
} as const;

function formatChars(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k chars` : `${n.toLocaleString()} chars`;
}

export function SourcesPanel({
  pieceId,
  findings,
}: {
  pieceId: Id<"contentPieces">;
  findings: Finding[];
}) {
  const sources = useQuery(api.contentSources.list, { pieceId });
  const setIncluded = useMutation(api.contentSources.setIncluded);
  const setAllIncluded = useMutation(api.contentSources.setAllIncluded);
  const removeSource = useMutation(api.contentSources.remove);
  const addNote = useMutation(api.contentSources.addNote);
  const generateUploadUrl = useMutation(api.contentSources.generateUploadUrl);
  const importFile = useAction(api.contentSourceImport.importFile);
  const importUrl = useAction(api.contentSourceImport.importUrl);
  const importFinding = useAction(api.contentSourceImport.importResearchFinding);

  const [open, setOpen] = useState(true);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [uploads, setUploads] = useState<Array<{ name: string; state: "uploading" | "failed"; error?: string }>>([]);
  const [findingBusy, setFindingBusy] = useState<Set<number>>(new Set());
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [status, setStatus] = useState("");
  const fileInput = useRef<HTMLInputElement | null>(null);
  const panelId = useId();

  const rows = sources ?? [];
  const included = rows.filter((row) => row.included);
  const includedChars = included.reduce((sum, row) => sum + row.charCount, 0);
  const importedUrls = new Set(rows.map((row) => row.url).filter(Boolean));

  const announce = (message: string) => setStatus(message);

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} is larger than 15 MB`);
        continue;
      }
      setUploads((current) => [...current.filter((u) => u.name !== file.name), { name: file.name, state: "uploading" }]);
      announce(`Reading ${file.name}…`);
      try {
        const uploadUrl = await generateUploadUrl({ pieceId });
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        const result = await importFile({ pieceId, storageId, name: file.name });
        setUploads((current) => current.filter((u) => u.name !== file.name));
        toast.success(`Added ${file.name}`, {
          description: `${formatChars(result.charCount)} of text${result.truncated ? " (long file: the first part was kept)" : ""}.`,
        });
        announce(`${file.name} added as a source.`);
      } catch (e) {
        const error = e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Try again.";
        setUploads((current) => current.map((u) => (u.name === file.name ? { ...u, state: "failed", error } : u)));
        announce(`${file.name} could not be read: ${error}`);
      }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const addUrl = async () => {
    const value = url.trim();
    if (!value || urlBusy) return;
    setUrlBusy(true);
    announce("Importing link…");
    try {
      const result = await importUrl({ pieceId, url: value });
      setUrl("");
      toast.success("Source added", {
        description: `${result.title}: ${formatChars(result.charCount)}${result.truncated ? " (long: the first part was kept)" : ""}.`,
      });
      announce(`${result.title} added as a source.`);
    } catch (e) {
      const message = e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Try again.";
      toast.error("Could not import that link", { description: message });
      announce(`Could not import that link: ${message}`);
    } finally {
      setUrlBusy(false);
    }
  };

  const importOne = async (index: number) => {
    setFindingBusy((current) => new Set(current).add(index));
    try {
      const result = await importFinding({ pieceId, index });
      if (!result.fullText) {
        toast.message("Saved the snippet only", {
          description: "The full page could not be read, so only the search snippet was stored (labelled as such).",
        });
      }
      return true;
    } catch (e) {
      toast.error("Import failed", {
        description: e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Try again.",
      });
      return false;
    } finally {
      setFindingBusy((current) => {
        const next = new Set(current);
        next.delete(index);
        return next;
      });
    }
  };

  const pendingFindings = findings
    .map((finding, index) => ({ finding, index }))
    .filter(({ finding }) => !finding.url || !importedUrls.has(finding.url));

  const importAll = async () => {
    announce(`Importing ${pendingFindings.length} findings…`);
    let ok = 0;
    // Sequential: keeps provider load polite and progress legible.
    for (const { index } of pendingFindings) {
      if (await importOne(index)) ok += 1;
    }
    toast.success(`Imported ${ok} of ${pendingFindings.length} findings`);
    announce(`Imported ${ok} of ${pendingFindings.length} findings.`);
  };

  const saveNote = async () => {
    try {
      await addNote({ pieceId, title: noteTitle, text: noteText });
      setNoteTitle("");
      setNoteText("");
      setNoteOpen(false);
      toast.success("Note added as a source");
    } catch (e) {
      toast.error("Could not add the note", {
        description: e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Try again.",
      });
    }
  };

  return (
    <section aria-labelledby={`${panelId}-title`} className="grid gap-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-sm font-mono text-caption font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls={`${panelId}-body`}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
          <span id={`${panelId}-title`}>Sources for AI</span>
        </button>
        <span className="font-mono text-caption text-muted-foreground">
          {sources === undefined
            ? "loading…"
            : `${included.length} of ${rows.length} included · ${formatChars(includedChars)}`}
        </span>
        {rows.length > 0 && (
          <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 font-mono text-caption" onClick={() => void setAllIncluded({ pieceId, included: true })}>
              Include all
            </Button>
            <Button size="sm" variant="ghost" className="h-7 font-mono text-caption" onClick={() => void setAllIncluded({ pieceId, included: false })}>
              Exclude all
            </Button>
          </span>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{status}</p>

      {open && (
        <div id={`${panelId}-body`} className="grid gap-3">
          {/* add sources */}
          <div className="grid gap-2 md:grid-cols-[auto_1fr_auto]">
            <div className="flex gap-1">
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={SOURCE_FILE_ACCEPT}
                className="sr-only"
                id={`${panelId}-file`}
                onChange={(e) => void uploadFiles(e.target.files)}
              />
              <Button size="sm" variant="outline" className="h-8 font-mono text-caption" onClick={() => fileInput.current?.click()}>
                <Upload className="size-3.5" /> Upload files
              </Button>
              <Button size="sm" variant="outline" className="h-8 font-mono text-caption" onClick={() => setNoteOpen(true)}>
                <ClipboardPaste className="size-3.5" /> Paste text
              </Button>
            </div>
            <div className="flex min-w-0 gap-1">
              <Label htmlFor={`${panelId}-url`} className="sr-only">Web page or YouTube link</Label>
              <Input
                id={`${panelId}-url`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addUrl()}
                placeholder="Paste a web page or YouTube link…"
                className="h-8 min-w-0 flex-1"
                inputMode="url"
              />
              <Button size="sm" variant="outline" className="h-8 font-mono text-caption" onClick={() => void addUrl()} disabled={!url.trim() || urlBusy}>
                {urlBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Add link
              </Button>
            </div>
          </div>
          <p className="font-mono text-caption text-muted-foreground">
            Files: PDF (with a text layer), DOCX, TXT, MD, CSV, JSON, HTML, SRT/VTT, up to 15 MB. YouTube links import the video's captions. Imported text is used as reference material, never as instructions.
          </p>

          {uploads.length > 0 && (
            <ul className="grid gap-1">
              {uploads.map((upload) => (
                <li key={upload.name} className="flex flex-wrap items-center gap-2 rounded-sm border px-2.5 py-1.5 font-mono text-caption">
                  {upload.state === "uploading" ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5 text-terminal-amber" />}
                  <span className="min-w-0 truncate">{upload.name}</span>
                  {upload.state === "uploading" ? (
                    <span className="text-muted-foreground">uploading and reading…</span>
                  ) : (
                    <>
                      <span className="text-terminal-amber">{upload.error}</span>
                      <Button size="sm" variant="ghost" className="ml-auto h-6 font-mono text-caption" onClick={() => setUploads((current) => current.filter((u) => u.name !== upload.name))}>
                        Dismiss
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* library */}
          {sources === undefined ? (
            <p className="font-mono text-caption text-muted-foreground">Loading sources…</p>
          ) : rows.length === 0 ? (
            <p className="rounded-sm border border-dashed p-3 font-mono text-caption text-muted-foreground">
              No sources yet. Upload files, add a link, paste notes, or import the full text of the research findings below. The AI then writes from these instead of general knowledge.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {rows.map((row) => {
                const Icon = KIND_ICON[row.kind];
                const checkboxId = `${panelId}-inc-${row._id}`;
                return (
                  <li key={row._id} className={cn("grid gap-1 rounded-sm border px-2.5 py-2", !row.included && "opacity-70")}>
                    <div className="flex min-w-0 items-start gap-2">
                      <Checkbox
                        id={checkboxId}
                        checked={row.included}
                        onCheckedChange={(checked) => void setIncluded({ id: row._id, included: checked === true })}
                        className="mt-0.5"
                        aria-describedby={`${checkboxId}-meta`}
                      />
                      <Icon className="mt-0.5 size-3.5 shrink-0 text-terminal-blue" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <label htmlFor={checkboxId} className="block cursor-pointer truncate font-mono text-caption font-medium">
                          {row.title}
                        </label>
                        <p id={`${checkboxId}-meta`} className="font-mono text-caption text-muted-foreground">
                          {row.included ? "included" : "excluded"} · {KIND_LABEL[row.kind]} · {formatChars(row.charCount)} · {row.extraction}
                        </p>
                      </div>
                      {row.truncated && (
                        <Badge variant="outline" className="shrink-0 font-mono text-caption text-terminal-amber" title="The original was longer than the storage limit; the first part was kept.">
                          trimmed
                        </Badge>
                      )}
                      {row.url && (
                        <a
                          href={row.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Open ${row.title} in a new tab`}
                        >
                          <Link2 className="size-3.5" />
                        </a>
                      )}
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="shrink-0 text-destructive"
                        aria-label={`Remove ${row.title}`}
                        onClick={async () => {
                          await removeSource({ id: row._id });
                          toast.success("Source removed");
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <details className="pl-6">
                      <summary className="cursor-pointer font-mono text-caption text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        preview
                      </summary>
                      <p className="mt-1 whitespace-pre-line break-words font-mono text-caption text-muted-foreground">
                        {row.preview}
                        {row.charCount > row.preview.length ? "…" : ""}
                      </p>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}

          {/* research findings → full text */}
          {findings.length > 0 && (
            <div className="grid gap-1.5 border-t pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-caption font-medium">Research findings ({findings.length})</p>
                <span className="font-mono text-caption text-muted-foreground">
                  snippets are always sent; import to give the AI the full text
                </span>
                {pendingFindings.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7 font-mono text-caption"
                    disabled={findingBusy.size > 0}
                    onClick={() => void importAll()}
                  >
                    {findingBusy.size > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Import all full text
                  </Button>
                )}
              </div>
              <ul className="grid gap-1">
                {findings.map((finding, index) => {
                  const imported = Boolean(finding.url && importedUrls.has(finding.url));
                  return (
                    <li key={`${finding.title}-${index}`} className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-caption">
                      <span className="text-terminal-green">[{finding.source}]</span>
                      {finding.url ? (
                        <a href={finding.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-terminal-blue hover:underline">
                          {finding.title}
                        </a>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{finding.title}</span>
                      )}
                      {imported ? (
                        <Badge variant="outline" className="font-mono text-caption text-terminal-green">in library</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 font-mono text-caption"
                          disabled={findingBusy.has(index)}
                          onClick={() => void importOne(index)}
                        >
                          {findingBusy.has(index) ? <Loader2 className="size-3 animate-spin" /> : <Download className="size-3" />}
                          {finding.url ? " Import full text" : " Add snippet"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">Paste text as a source</DialogTitle>
            <DialogDescription className="font-mono text-caption">
              Interview answers, product specs, a transcript, your own notes. Long text is fine; the AI retrieves the relevant parts.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${panelId}-note-title`}>Title</Label>
              <Input id={`${panelId}-note-title`} value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} placeholder="e.g. Customer interview, March" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${panelId}-note-text`}>Text</Label>
              <Textarea id={`${panelId}-note-text`} value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={10} />
              <span className="font-mono text-caption text-muted-foreground">{noteText.length.toLocaleString()} characters</span>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setNoteOpen(false)}>Cancel</Button>
              <Button onClick={() => void saveNote()} disabled={!noteText.trim()}>Add source</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
