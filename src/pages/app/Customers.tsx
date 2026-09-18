import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Users } from "lucide-react";

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
import { Switch } from "@/components/ui/switch";


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
  const [consent, setConsent] = useState(false);
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
        tags: tags.split(/[,\n]/).map((t) => t.trim()).filter(Boolean),
        consentMarketing: consent,
      });
      toast.success("Contact added");
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
      <label className="flex items-center gap-3 rounded-md border p-3">
        <Switch checked={consent} onCheckedChange={setConsent} />
        <span className="font-mono text-small">Marketing consent (email)</span>
      </label>
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

export default function Customers({ projectId }: { projectId: Id<"projects"> }) {
  const contacts = useQuery(api.contacts.list, { projectId }) ?? [];
  const remove = useMutation(api.contacts.remove);
  const update = useMutation(api.contacts.update);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <ModuleHeader
        icon={Users}
        title="Customers"
        subtitle="Contacts, consent and segments — consent lives here, owned by you"
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> Add contact
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-mono text-h3">New contact</DialogTitle>
              <DialogDescription className="font-mono text-caption">
                Consent is recorded with timestamp and source — campaigns only
                email contacts who opted in.
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
          hint="Add contacts manually or import. Marketing consent is stored per contact and checked at send time by every campaign."
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
                    <button
                      className="flex items-center gap-2"
                      onClick={async () => {
                        const marketing = !c.consent?.marketing;
                        try {
                          await update({
                            id: c._id,
                            consentMarketing: marketing,
                          });
                          toast.success(
                            marketing ? "Consent granted" : "Consent withdrawn",
                          );
                        } catch (e) {
                          toast.error("Update failed", {
                            description:
                              e instanceof Error ? e.message : "Try again.",
                          });
                        }
                      }}
                    >
                      <Switch
                        checked={c.consent?.marketing ?? false}
                        onCheckedChange={() => {}}
                        aria-label={`Toggle marketing consent for ${c.name ?? c.email ?? "contact"}`}
                      />
                      <span className="text-caption text-muted-foreground">
                        {c.consent?.source ?? "—"}
                      </span>
                    </button>
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
