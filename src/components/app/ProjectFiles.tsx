import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ProjectFile = {
  _id: Id<"projectFiles">;
  name: string;
  mimeType?: string;
  sizeBytes?: number;
  storageId: Id<"_storage">;
  excerpt?: string;
  createdAt: number;
};

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Text excerpt for AI context — readable text files get inlined, binaries get a stub. */
async function buildExcerpt(file: File): Promise<string | undefined> {
  const textish =
    /^text\//.test(file.type) ||
    /json|csv|xml|yaml|yml|md|markdown|html|svg|txt/.test(file.name);
  if (!textish || file.size > 512 * 1024) return undefined;
  try {
    return (await file.text()).slice(0, 4_000);
  } catch {
    return undefined;
  }
}

function FileRow({ file, onDelete }: { file: ProjectFile; onDelete: () => void }) {
  const url = useQuery(api.files.getFileUrl, { storageId: file.storageId });
  return (
    <li className="flex items-center gap-2 rounded-sm border bg-card px-3 py-2">
      <FileText className="size-4 shrink-0 text-terminal-green" />
      <a
        href={url ?? "#"}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 truncate font-mono text-caption hover:underline"
      >
        {file.name}
      </a>
      <span className="ml-auto shrink-0 font-mono text-caption text-muted-foreground">
        {formatSize(file.sizeBytes)}
      </span>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={`Remove ${file.name}`}
        className="text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );
}

export function ProjectFilesSection({
  projectId,
  files,
  compact = false,
}: {
  projectId: Id<"projects">;
  files: ProjectFile[];
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const getUploadUrl = useMutation(api.files.generateUploadUrl);
  const attach = useMutation(api.files.attach);
  const removeFile = useMutation(api.files.remove);

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(list).slice(0, 10)) {
        const uploadUrl = await getUploadUrl({ projectId });
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) throw new Error(`Upload of ${file.name} failed`);
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await attach({
          projectId,
          storageId,
          name: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
          excerpt: await buildExcerpt(file),
        });
      }
      toast.success(
        list.length === 1 ? "File attached" : `${list.length} files attached`,
        { description: "AI features now use these for richer context." },
      );
    } catch (e) {
      toast.error("Upload failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <div
        className={cn(
          "rounded-md border border-dashed p-4 text-center transition-colors ease-terminal",
          dragOver && "border-terminal-green bg-terminal-green-soft",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFiles(e.dataTransfer.files);
        }}
      >
        <Paperclip className="mx-auto size-4 text-muted-foreground" />
        <p className="mt-2 font-mono text-caption text-muted-foreground">
          Drop PDFs, Figma exports, briefs — anything that gives context.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          Attach files
        </Button>
      </div>

      {files.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          {files.map((f) => (
            <FileRow
              key={f._id}
              file={f}
              onDelete={async () => {
                try {
                  await removeFile({ id: f._id });
                } catch (e) {
                  toast.error("Delete failed", {
                    description: e instanceof Error ? e.message : "Try again.",
                  });
                }
              }}
            />
          ))}
          {compact && (
            <li className="font-mono text-caption text-muted-foreground">
              {files.length} file{files.length === 1 ? "" : "s"} attached
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
