import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Row = Doc<"billingPlans">;
type ModuleOption = { id: string; label: string; core: boolean };

type Draft = {
  id?: Id<"billingPlans">;
  key: string;
  kind: "plan" | "addon";
  name: string;
  description: string;
  modules: string[];
  price: string; // major units as typed, e.g. "29.00"
  currency: string;
  interval: "month" | "year";
  stripePriceId: string;
  trialDays: string;
  highlights: string;
  status: "draft" | "active" | "archived";
  sortOrder: string;
};

const EMPTY: Draft = {
  key: "",
  kind: "addon",
  name: "",
  description: "",
  modules: [],
  price: "0",
  currency: "EUR",
  interval: "month",
  stripePriceId: "",
  trialDays: "",
  highlights: "",
  status: "draft",
  sortOrder: "100",
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "Try again.";
}

function minorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

function toDraft(row: Row): Draft {
  const digits = minorDigits(row.currency);
  return {
    id: row._id,
    key: row.key,
    kind: row.kind,
    name: row.name,
    description: row.description ?? "",
    modules: row.modules,
    price: (row.priceMinor / 10 ** digits).toFixed(digits),
    currency: row.currency,
    interval: row.interval,
    stripePriceId: row.stripePriceId ?? "",
    trialDays: row.trialDays ? String(row.trialDays) : "",
    highlights: row.highlights.join("\n"),
    status: row.status,
    sortOrder: String(row.sortOrder),
  };
}

function priceText(row: Row): string {
  if (row.priceMinor === 0) return "free";
  const digits = minorDigits(row.currency);
  return `${(row.priceMinor / 10 ** digits).toFixed(digits)} ${row.currency}/${row.interval}`;
}

/**
 * Operator catalog: create and edit plans and add-ons (mix and match). The
 * core bundle (Understand, Journeys, Create) is always included for every
 * customer. A row only sells once it is active and has a Stripe price whose
 * amount matches — the checkout re-checks both.
 */
export function PlansTab() {
  const data = useQuery(api.billingPlans.adminList, {});
  const save = useMutation(api.billingPlans.adminSave);
  const seed = useMutation(api.billingPlans.adminSeedDefaults);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const submit = async () => {
    if (!draft) return;
    const digits = minorDigits(draft.currency.trim().toUpperCase() || "EUR");
    const price = Number(draft.price.replace(",", "."));
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Enter a price like 29 or 29.00");
      return;
    }
    setSaving(true);
    try {
      await save({
        id: draft.id,
        key: draft.key,
        kind: draft.kind,
        name: draft.name,
        description: draft.description || undefined,
        modules: draft.modules,
        priceMinor: Math.round(price * 10 ** digits),
        currency: draft.currency,
        interval: draft.interval,
        stripePriceId: draft.stripePriceId || undefined,
        trialDays: draft.trialDays ? Number(draft.trialDays) : undefined,
        highlights: draft.highlights.split("\n"),
        status: draft.status,
        sortOrder: Number(draft.sortOrder) || 0,
      });
      toast.success("Saved");
      setDraft(null);
    } catch (error) {
      toast.error("Couldn’t save", { description: errorText(error) });
    } finally {
      setSaving(false);
    }
  };

  const modules: ModuleOption[] = data?.modules ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="px-4">
          <CardTitle className="font-mono text-h3">Plans and add-ons</CardTitle>
          <CardDescription className="font-mono text-caption">
            Understand, Journeys and Create are always included. Plans bundle more tools; add-ons sell one tool on its own.
            Customers only see active rows, and a paid row needs its Stripe price id (the amount must match Stripe).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
              <Plus className="size-4" aria-hidden="true" /> New plan or add-on
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={seeding}
              onClick={async () => {
                setSeeding(true);
                try {
                  const { created } = await seed({});
                  toast.success(created ? `Added ${created} draft rows` : "Nothing to add — all defaults exist");
                } catch (error) {
                  toast.error("Couldn’t add defaults", { description: errorText(error) });
                } finally {
                  setSeeding(false);
                }
              }}
            >
              {seeding ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Start from today’s tiers
            </Button>
          </div>
          {data === undefined ? (
            <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
            </p>
          ) : data.rows.length === 0 ? (
            <p className="font-mono text-caption text-muted-foreground">
              No catalog yet — customers see the built-in tiers. Start from today’s tiers or add a row.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {data.rows.map((row) => (
                <li key={row._id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-small font-medium">
                      {row.name}{" "}
                      <Badge variant="outline" className="ml-1 font-mono text-caption">{row.kind}</Badge>{" "}
                      <Badge
                        variant="outline"
                        className={
                          row.status === "active"
                            ? "font-mono text-caption text-terminal-green"
                            : "font-mono text-caption text-muted-foreground"
                        }
                      >
                        {row.status}
                      </Badge>
                    </p>
                    <p className="font-mono text-caption text-muted-foreground">
                      {row.key} · {priceText(row)} · {row.modules.join(", ") || "no tools"}
                      {row.stripePriceId ? ` · ${row.stripePriceId}` : " · no Stripe price"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setDraft(toDraft(row))}>
                    <Pencil className="size-3.5" aria-hidden="true" /> Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={draft !== null} onOpenChange={(open) => (!open ? setDraft(null) : undefined)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">{draft?.id ? "Edit" : "New"} {draft?.kind === "plan" ? "plan" : "add-on"}</DialogTitle>
            <DialogDescription className="font-mono text-caption">
              Changes are audited. Existing customers keep what they paid for when a row is archived.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-3">
              <fieldset className="grid gap-1.5">
                <legend className="font-mono text-caption">Type</legend>
                <div className="flex gap-2">
                  {(["plan", "addon"] as const).map((kind) => (
                    <Button
                      key={kind}
                      type="button"
                      size="sm"
                      variant={draft.kind === kind ? "default" : "outline"}
                      aria-pressed={draft.kind === kind}
                      disabled={Boolean(draft.id)}
                      onClick={() => setDraft({ ...draft, kind })}
                    >
                      {kind === "plan" ? "Plan (bundle)" : "Add-on (single tool)"}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-key">Key</Label>
                <Input
                  id="plan-key"
                  value={draft.key}
                  disabled={Boolean(draft.id)}
                  onChange={(e) => setDraft({ ...draft, key: e.target.value })}
                  placeholder="e.g. addon-promote or growth"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-name">Name customers see</Label>
                <Input id="plan-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-desc">Short description</Label>
                <Input id="plan-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="font-mono text-caption">Tools it unlocks</legend>
                <div className="grid grid-cols-2 gap-2">
                  {modules.map((module) => {
                    const id = `plan-module-${module.id}`;
                    return (
                      <div key={module.id} className="flex items-center gap-2">
                        <Checkbox
                          id={id}
                          checked={module.core || draft.modules.includes(module.id)}
                          disabled={module.core}
                          onCheckedChange={(checked) =>
                            setDraft({
                              ...draft,
                              modules: checked
                                ? [...new Set([...draft.modules, module.id])]
                                : draft.modules.filter((m) => m !== module.id),
                            })
                          }
                        />
                        <Label htmlFor={id} className="font-mono text-caption">
                          {module.label}{module.core ? " (always included)" : ""}
                        </Label>
                      </div>
                    );
                  })}
                </div>
              </fieldset>
              <div className="grid grid-cols-3 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="plan-price">Price</Label>
                  <Input id="plan-price" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="plan-currency">Currency</Label>
                  <Input id="plan-currency" value={draft.currency} maxLength={3} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="plan-interval">Billed every</Label>
                  <select
                    id="plan-interval"
                    className="h-9 rounded-md border bg-background px-2 font-mono text-small"
                    value={draft.interval}
                    onChange={(e) => setDraft({ ...draft, interval: e.target.value as "month" | "year" })}
                  >
                    <option value="month">month</option>
                    <option value="year">year</option>
                  </select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-stripe">Stripe price id</Label>
                <Input id="plan-stripe" value={draft.stripePriceId} onChange={(e) => setDraft({ ...draft, stripePriceId: e.target.value.trim() })} placeholder="price_…" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="plan-trial">Free trial (days)</Label>
                  <Input id="plan-trial" inputMode="numeric" value={draft.trialDays} onChange={(e) => setDraft({ ...draft, trialDays: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="plan-order">Display order</Label>
                  <Input id="plan-order" inputMode="numeric" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="plan-highlights">Highlights (one per line)</Label>
                <Textarea id="plan-highlights" rows={3} value={draft.highlights} onChange={(e) => setDraft({ ...draft, highlights: e.target.value })} />
              </div>
              <fieldset className="grid gap-1.5">
                <legend className="font-mono text-caption">Status</legend>
                <div className="flex flex-wrap gap-2">
                  {(["draft", "active", "archived"] as const).map((status) => (
                    <Button
                      key={status}
                      type="button"
                      size="sm"
                      variant={draft.status === status ? "default" : "outline"}
                      aria-pressed={draft.status === status}
                      onClick={() => setDraft({ ...draft, status })}
                    >
                      {status}
                    </Button>
                  ))}
                </div>
              </fieldset>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Operator grant/revoke of add-ons for one organization (a comp, a pilot, a
 * sales-led deal). Audited with a reason; never presented as a payment.
 * Stripe-paid add-ons are shown but can only change through Stripe.
 */
export function OrganizationAddonsDialog({
  organizationId,
  organizationName,
}: {
  organizationId: Id<"organizations">;
  organizationName: string;
}) {
  const [open, setOpen] = useState(false);
  const catalog = useQuery(api.billingPlans.adminList, open ? {} : "skip");
  const held = useQuery(api.billingPlans.adminOrganizationAddons, open ? { organizationId } : "skip");
  const grant = useMutation(api.billingPlans.grantAddon);
  const revoke = useMutation(api.billingPlans.revokeAddon);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const addons = (catalog?.rows ?? []).filter((row) => row.kind === "addon" && row.status !== "draft");

  const act = async (key: string, give: boolean) => {
    setBusy(key);
    try {
      if (give) await grant({ organizationId, addonKey: key, reason });
      else await revoke({ organizationId, addonKey: key, reason });
      toast.success(give ? "Add-on granted" : "Add-on removed");
    } catch (error) {
      toast.error("Couldn’t update", { description: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add-ons
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-mono text-h3">Add-ons for {organizationName}</DialogTitle>
            <DialogDescription className="font-mono text-caption">
              Granting is free for the customer and recorded in the audit log. Paid add-ons change only through Stripe.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`grant-reason-${organizationId}`}>Reason</Label>
            <Input
              id={`grant-reason-${organizationId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. pilot until 31 Oct, ticket #123"
            />
          </div>
          {catalog === undefined || held === undefined ? (
            <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
            </p>
          ) : addons.length === 0 ? (
            <p className="font-mono text-caption text-muted-foreground">No active add-ons in the catalog yet (Plans & add-ons tab).</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {addons.map((addon) => {
                const holding = held.find((row) => row.addonKey === addon.key && row.status === "active");
                return (
                  <li key={addon.key} className="flex items-center gap-2 px-3 py-2">
                    <span className="min-w-0 flex-1 font-mono text-small">{addon.name}</span>
                    {holding?.source === "stripe" ? (
                      <Badge variant="outline" className="font-mono text-caption text-terminal-green">paid</Badge>
                    ) : holding ? (
                      <Button size="sm" variant="ghost" disabled={busy !== null || reason.trim().length < 3} onClick={() => act(addon.key, false)}>
                        Remove
                      </Button>
                    ) : (
                      <Button size="sm" disabled={busy !== null || reason.trim().length < 3} onClick={() => act(addon.key, true)}>
                        Grant
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
