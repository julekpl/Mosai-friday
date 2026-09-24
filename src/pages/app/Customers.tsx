import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { FileUp, Loader2, Plus, Trash2, Users } from "lucide-react";

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
import {
  normalizeCustomerEmail,
  isValidCustomerEmail,
  parseCustomerCsv,
  type ParsedCustomerCsv,
} from "@/lib/customerCsv";

function ContactForm({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const create = useMutation(api.contacts.create);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [tags, setTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() && !email.trim()) return;
    setIsSaving(true);
    try {
      await create({
        projectId,
        name: name.trim() || undefined,
        email: email.trim() || undefined,
        company: company.trim() || undefined,
        tags: tags
          .split(/[,\n]/)
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast.success("Contact is ready");
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
          <Label htmlFor="ct-name">Name</Label>
          <Input
            id="ct-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            autoFocus
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ct-email">Email</Label>
          <Input
            id="ct-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="ct-company">Company</Label>
          <Input
            id="ct-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Optional"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ct-tags">Tags</Label>
          <Input
            id="ct-tags"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Comma separated"
          />
        </div>
      </div>
      <p className="text-caption text-muted-foreground">
        Adding a contact does not subscribe them to marketing.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          disabled={isSaving || (!name.trim() && !email.trim())}
        >
          {isSaving && <Loader2 className="size-4 animate-spin" />}
          Add contact
        </Button>
      </div>
    </div>
  );
}

type ImportField = "name" | "email" | "company" | "tags";
const IMPORT_FIELDS: ImportField[] = ["name", "email", "company", "tags"];

function CustomerImport({
  projectId,
  onDone,
}: {
  projectId: Id<"projects">;
  onDone: () => void;
}) {
  const importBatch = useMutation(api.contacts.importBatch);
  const [parsed, setParsed] = useState<ParsedCustomerCsv | null>(null);
  const [mapping, setMapping] = useState<Record<ImportField, string>>({
    name: "",
    email: "",
    company: "",
    tags: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  const readFile = async (file?: File) => {
    setError(null);
    setParsed(null);
    if (!file) return;
    if (file.size > 128 * 1024) {
      setError("CSV must be 128 KB or smaller.");
      return;
    }
    try {
      const result = parseCustomerCsv(await file.text());
      setFileName(file.name);
      setParsed(result);
      setMapping({
        name:
          result.headers.find(
            (header) => header.trim().toLowerCase() === "name",
          ) ?? "",
        email:
          result.headers.find(
            (header) => header.trim().toLowerCase() === "email",
          ) ?? "",
        company:
          result.headers.find(
            (header) => header.trim().toLowerCase() === "company",
          ) ?? "",
        tags:
          result.headers.find(
            (header) => header.trim().toLowerCase() === "tags",
          ) ?? "",
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not read this CSV.",
      );
    }
  };

  const rows =
    parsed?.rows.map((cells, index) => {
      const value = (field: ImportField) => {
        const column = mapping[field];
        const cellIndex = column ? parsed.headers.indexOf(column) : -1;
        return cellIndex < 0 ? "" : (cells[cellIndex]?.trim() ?? "");
      };
      const email = normalizeCustomerEmail(value("email"));
      const valid = isValidCustomerEmail(email);
      const priorSameFile = parsed.rows.slice(0, index).some((earlier) => {
        const mappedIndex = mapping.email
          ? parsed.headers.indexOf(mapping.email)
          : -1;
        return (
          mappedIndex >= 0 &&
          normalizeCustomerEmail(earlier[mappedIndex] ?? "") === email
        );
      });
      return {
        name: value("name"),
        email,
        company: value("company"),
        tags: value("tags"),
        valid,
        duplicate: priorSameFile,
      };
    }) ?? [];
  const readyCount = rows.filter((row) => row.valid && !row.duplicate).length;

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const receipt = await importBatch({
        projectId,
        rows: rows
          .filter((row) => row.valid && !row.duplicate)
          .map((row) => ({
            email: row.email,
            name: row.name || undefined,
            company: row.company || undefined,
            tags: row.tags
              .split(/[;,]/)
              .map((tag) => tag.trim())
              .filter(Boolean),
          })),
      });
      const fileDuplicates = rows.filter(
        (row) => row.valid && row.duplicate,
      ).length;
      const fileInvalid = rows.filter((row) => !row.valid).length;
      toast.success(
        `Import complete: ${receipt.inserted} added, ${receipt.skipped + fileDuplicates} duplicates skipped, ${receipt.invalid + fileInvalid} invalid rows skipped.`,
      );
      onDone();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Import failed. No contacts were saved; try again.",
      );
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <p className="text-caption text-muted-foreground">
        Preview your CSV before importing. Repeated addresses in this file are
        skipped in the preview. Existing project contacts are checked again when
        you import. Imported contacts are not subscribed to marketing.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="customer-csv">CSV file</Label>
        <Input
          id="customer-csv"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void readFile(event.target.files?.[0])}
        />
        {fileName && (
          <p className="text-caption text-muted-foreground">{fileName}</p>
        )}
      </div>
      {parsed && (
        <>
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 font-medium">Map your columns</legend>
            {IMPORT_FIELDS.map((field) => (
              <div key={field} className="grid gap-1">
                <Label htmlFor={`map-${field}`}>
                  {field === "tags"
                    ? "Tags (optional)"
                    : field[0].toUpperCase() + field.slice(1)}
                </Label>
                <select
                  id={`map-${field}`}
                  className="rounded-md border bg-background px-3 py-2 text-small"
                  value={mapping[field]}
                  onChange={(event) =>
                    setMapping((current) => ({
                      ...current,
                      [field]: event.target.value,
                    }))
                  }
                >
                  <option value="">Do not import</option>
                  {parsed.headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </fieldset>
          <div aria-live="polite" className="grid gap-2">
            <p className="text-small font-medium">
              Preview: {readyCount} ready,{" "}
              {rows.filter((row) => row.duplicate).length} duplicates skipped,{" "}
              {rows.filter((row) => !row.valid).length} invalid rows skipped.
            </p>
            <div className="max-h-48 overflow-auto rounded-md border">
              <table className="w-full text-small">
                <thead>
                  <tr>
                    <th className="p-2 text-left">Email</th>
                    <th className="p-2 text-left">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 20).map((row, index) => (
                    <tr key={`${row.email}-${index}`} className="border-t">
                      <td className="p-2">{row.email || "—"}</td>
                      <td className="p-2">
                        {!row.valid
                          ? "Invalid email — skip"
                          : row.duplicate
                            ? "Repeated in this file — skip"
                            : "Ready to import"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 20 && (
              <p className="text-caption text-muted-foreground">
                Showing first 20 of {rows.length} rows.
              </p>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone} disabled={busy}>
          Cancel
        </Button>
        <Button
          onClick={() => void commit()}
          disabled={!parsed || !readyCount || busy}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileUp className="size-4" />
          )}
          Import up to {readyCount} contacts
        </Button>
      </div>
    </div>
  );
}

export default function Customers({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const contacts = useQuery(api.contacts.list, { projectId }) ?? [];
  const remove = useMutation(api.contacts.remove);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div>
      <ModuleHeader
        icon={Users}
        title="Customers"
        subtitle="Manage project contacts; importing does not subscribe them to marketing."
      >
        <Dialog open={importOpen} onOpenChange={setImportOpen}>
          <DialogTrigger asChild>
            <Button variant="outline">
              <FileUp className="size-4" /> Import CSV
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">
                Import contacts
              </DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Review the mapping and preview before anything is saved.
              </DialogDescription>
            </DialogHeader>
            <CustomerImport
              projectId={projectId}
              onDone={() => setImportOpen(false)}
            />
          </DialogContent>
        </Dialog>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add contact
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">
                New contact
              </DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Adding a contact does not subscribe them to marketing.
              </DialogDescription>
            </DialogHeader>
            <ContactForm projectId={projectId} onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </ModuleHeader>

      {contacts.length === 0 ? (
        <ModuleEmpty
          icon={Users}
          title="No contacts yet"
          hint="Add contacts manually or import a CSV. Contacts are not subscribed to marketing by default."
          action={
            <Button onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Add the first contact
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-md border bg-card shadow-card">
          <table className="w-full font-mono text-small">
            <thead>
              <tr className="border-b bg-muted/50 text-caption text-muted-foreground">
                <th className="px-4 py-2 text-left font-medium">contact</th>
                <th className="px-4 py-2 text-left font-medium">company</th>
                <th className="px-4 py-2 text-left font-medium">consent</th>
                <th className="px-4 py-2 text-right font-medium"> </th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c._id} className="border-b last:border-b-0">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{c.name ?? "—"}</p>
                    <p className="text-caption text-muted-foreground">
                      {c.email ?? "no email"}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {c.company ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-caption text-muted-foreground">
                      {c.consent?.marketing
                        ? "Unverified legacy value — not subscribed"
                        : "No verified opt-in"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <ConfirmDelete
                      what={c.name ?? "this contact"}
                      onConfirm={async () => {
                        await remove({ id: c._id });
                        toast.success("Contact deleted");
                      }}
                      trigger={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Delete ${c.name ?? "contact"}`}
                          className="text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
