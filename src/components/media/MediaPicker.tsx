import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { useMutation, useQuery } from "convex/react";
import { Camera, Upload } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * MD-0: the one picture picker (collision C2). A bottom Sheet on phones, a
 * Dialog on desktop. It only hands back a `projectFileId`; the caller's server
 * mutation resolves the address and credit, never a URL from this component.
 */

type Picture = {
  _id: Id<"projectFiles">;
  name: string;
  source: "upload" | "owner_site" | "stock";
  url: string;
  photographer?: string;
};

type TabKey = "upload" | "owner_site" | "stock";

const TABS: Array<{ key: TabKey; label: string; empty: string }> = [
  { key: "upload", label: "Your photos", empty: "No photos yet. Upload one or take one with your phone." },
  { key: "owner_site", label: "From your website", empty: "No pictures from your website yet." },
  { key: "stock", label: "Stock photos", empty: "No stock photos saved for this business yet." },
];

export function MediaPicker({
  projectId,
  open,
  onOpenChange,
  onPick,
  returnFocusRef,
  title = "Choose a picture",
}: {
  projectId: Id<"projects">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (projectFileId: Id<"projectFiles">) => Promise<void>;
  returnFocusRef: RefObject<HTMLElement | null>;
  title?: string;
}) {
  const isMobile = useIsMobile();
  const description = "Pick a picture, then choose Use this picture.";
  const body = open ? (
    <PickerBody projectId={projectId} onPick={onPick} onDone={() => onOpenChange(false)} />
  ) : null;
  const returnFocus = (event: Event) => {
    event.preventDefault();
    returnFocusRef.current?.focus();
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-dvh overflow-y-auto p-4" onCloseAutoFocus={returnFocus}>
          <SheetHeader className="p-0">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {body}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  projectId,
  onPick,
  onDone,
}: {
  projectId: Id<"projects">;
  onPick: (projectFileId: Id<"projectFiles">) => Promise<void>;
  onDone: () => void;
}) {
  const pictures = useQuery(api.files.pictures, { projectId }) as Picture[] | undefined;
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const attach = useMutation(api.files.attach);
  const [tab, setTab] = useState<TabKey>("upload");
  const [selected, setSelected] = useState<Id<"projectFiles"> | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const groupName = useId();

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("That file is not a picture. Choose a photo instead.");
      return;
    }
    setBusy(true);
    setStatus("Uploading your photo…");
    try {
      const uploadUrl = await generateUploadUrl({ projectId });
      const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error("upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const fileId = await attach({ projectId, storageId, name: file.name, mimeType: file.type, sizeBytes: file.size });
      setSelected(fileId);
      setTab("upload");
      setStatus("Photo uploaded and selected.");
    } catch {
      setStatus("Could not upload that photo. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const use = async () => {
    if (!selected) return;
    setBusy(true);
    setStatus("");
    try {
      await onPick(selected);
      onDone();
    } catch {
      setStatus("Could not use that picture. Try again or pick another.");
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>
      <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
        <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-3">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="min-h-11 whitespace-normal">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((t) => {
          const items = (pictures ?? []).filter((p) => p.source === t.key);
          let list: ReactNode;
          if (pictures === undefined) list = <p className="text-small text-muted-foreground">Loading pictures…</p>;
          else if (!items.length) list = <p className="text-small text-muted-foreground">{t.empty}</p>;
          else
            list = (
              <fieldset className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
                <legend className="sr-only">{t.label}</legend>
                {items.map((picture) => (
                  <label
                    key={picture._id}
                    className={cn(
                      "relative grid cursor-pointer gap-1 rounded-md border p-1 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                      selected === picture._id && "border-primary ring-2 ring-primary",
                    )}
                  >
                    <input
                      type="radio"
                      name={groupName}
                      className="sr-only"
                      checked={selected === picture._id}
                      onChange={() => setSelected(picture._id)}
                    />
                    <img src={picture.url} alt="" loading="lazy" className="aspect-square w-full rounded-sm bg-muted object-cover" />
                    <span className="truncate text-caption">
                      {picture.photographer ? `Photo by ${picture.photographer}` : picture.name}
                    </span>
                  </label>
                ))}
              </fieldset>
            );
          return (
            <TabsContent key={t.key} value={t.key} className="grid gap-3 pt-2">
              {t.key === "upload" ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => uploadRef.current?.click()}>
                    <Upload className="size-4" aria-hidden="true" />
                    Upload a photo
                  </Button>
                  <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => cameraRef.current?.click()}>
                    <Camera className="size-4" aria-hidden="true" />
                    Take a photo
                  </Button>
                  <input
                    ref={uploadRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => void upload(event.target.files?.[0])}
                  />
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    tabIndex={-1}
                    aria-hidden="true"
                    onChange={(event) => void upload(event.target.files?.[0])}
                  />
                </div>
              ) : null}
              {list}
              {t.key === "stock" && items.some((p) => p.photographer) ? (
                <p className="text-caption text-muted-foreground">
                  <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    Photos provided by Pexels
                  </a>
                </p>
              ) : null}
            </TabsContent>
          );
        })}
      </Tabs>
      {status ? (
        <p className="text-small text-muted-foreground" aria-hidden="true">
          {status}
        </p>
      ) : null}
      <PickerFooter>
        <Button type="button" className="min-h-11" disabled={!selected || busy} onClick={() => void use()}>
          Use this picture
        </Button>
      </PickerFooter>
    </div>
  );
}

function PickerFooter({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  return isMobile ? <SheetFooter className="p-0">{children}</SheetFooter> : <DialogFooter>{children}</DialogFooter>;
}
