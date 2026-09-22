import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AlertTriangle, Check, CreditCard, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";

/** Presentation only. Which modules each plan includes is **not** listed here:
 *  it comes from the capability registry over `entitlements.plans` (T2.3).
 *  Whether a plan can actually be bought comes from `billing.catalog` (T2.4):
 *  the owner has not finalised prices, so an unconfigured plan is honestly
 *  shown as unavailable rather than sold. */
const PLAN_CARDS = [
  {
    id: "free",
    name: "Free",
    price: "€0",
    blurb: "Understand + Create. See if the workflow fits.",
  },
  {
    id: "starter",
    name: "Starter",
    price: "€29/mo",
    blurb: "Everything to launch: build, customers, promote.",
  },
  {
    id: "growth",
    name: "Growth",
    price: "€79/mo",
    blurb: "Add commerce: sell products with feeds.",
  },
  {
    id: "scale",
    name: "Scale",
    price: "€199/mo",
    blurb: "The full growth OS with insights and recommendations.",
  },
] as const;

const RETURN_URL = () =>
  typeof window === "undefined" ? "/app/billing" : `${window.location.origin}/app/billing`;

export default function Billing() {
  const billing = useQuery(api.billing.currentPlan);
  const planCatalog = useQuery(api.entitlements.plans);
  const organization = useQuery(api.billing.currentOrganization);
  const organizationId = organization?.organizationId;
  const billingState = useQuery(
    api.billing.subscription,
    organizationId ? { organizationId } : "skip",
  );
  const catalog = useQuery(api.billing.catalog);

  const changePlan = useMutation(api.billing.changePlan);
  const cancelPlan = useMutation(api.billing.cancelPlan);
  const deleteAccount = useMutation(api.billing.deleteAccount);
  const startCheckout = useAction(api.billing.startCheckout);
  const openPortal = useAction(api.billing.openPortal);
  const [busy, setBusy] = useState<string | null>(null);

  const currentPlan = billingState?.plan ?? billing?.plan ?? "free";
  const selfServe = billing?.selfServePlanChanges ?? false;
  const configuredPlan = (plan: string) =>
    catalog?.plans.find((entry) => entry.plan === plan)?.configured ?? false;
  const checkoutReady = catalog?.configured ?? false;

  const doChange = async (plan: string) => {
    setBusy(plan);
    try {
      await changePlan({ plan: plan as "free" | "starter" | "growth" | "scale" });
      toast.success(`Switched to ${plan}`);
    } catch (e) {
      toast.error("Plan change failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const doCheckout = async (plan: string) => {
    if (!organizationId) {
      toast.error("No workspace yet — create a project first.");
      return;
    }
    setBusy(plan);
    try {
      const { url } = await startCheckout({
        organizationId: organizationId as Id<"organizations">,
        plan,
        successUrl: `${RETURN_URL()}?checkout=success`,
        cancelUrl: `${RETURN_URL()}?checkout=cancelled`,
      });
      // The plan is NOT granted here: the browser landing on Stripe's success
      // page proves nothing. The verified webhook writes the mirror once Stripe
      // confirms the subscription.
      window.location.assign(url);
    } catch (e) {
      toast.error("Could not start checkout", {
        description: e instanceof Error ? e.message : "Try again.",
      });
      setBusy(null);
    }
  };

  const doPortal = async () => {
    if (!organizationId) return;
    setBusy("portal");
    try {
      const { url } = await openPortal({
        organizationId: organizationId as Id<"organizations">,
        returnUrl: RETURN_URL(),
      });
      window.location.assign(url);
    } catch (e) {
      toast.error("Could not open billing portal", {
        description: e instanceof Error ? e.message : "Try again.",
      });
      setBusy(null);
    }
  };

  const doCancel = async () => {
    setBusy("cancel");
    try {
      await cancelPlan();
      toast.success("Subscription canceled — you're on Free");
    } catch (e) {
      toast.error("Cancel failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (confirmText: string) => {
    if (confirmText !== "DELETE") {
      toast.error("Type DELETE to confirm account deletion.");
      return;
    }
    try {
      await deleteAccount();
      toast.success("Account deleted");
      window.location.assign("/");
    } catch (e) {
      toast.error("Deletion failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  return (
    <div>
      <header className="mb-8 flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-card shadow-card">
          <Sparkles className="size-5 text-terminal-green" />
        </span>
        <div className="min-w-0">
          <h1 className="font-mono text-h1">Plan &amp; billing</h1>
          <p className="font-mono text-caption text-muted-foreground">
            Modules are unlocked per plan — upgrade, manage or cancel anytime.
          </p>
        </div>
        <Badge className="ml-auto" variant="outline">
          <span className="font-mono text-caption">current: </span>
          {currentPlan}
          {billingState?.planStatus && billingState.planStatus !== "active"
            ? ` · ${billingState.planStatus}`
            : ""}
        </Badge>
      </header>

      {billingState?.planStatus === "past_due" && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-md border border-terminal-amber/50 bg-terminal-amber-soft/30 px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-terminal-amber" />
          <div>
            <p className="font-mono text-small font-medium">
              Payment failed — your plan is in a grace period.
            </p>
            <p className="font-mono text-caption text-muted-foreground">
              Update your payment method to keep your modules. Nothing is
              deleted; if the grace period ends we start a wind-down.
            </p>
          </div>
        </div>
      )}

      {billingState?.planStatus === "wind_down" && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2 rounded-md border border-terminal-red/40 bg-card px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-terminal-red" />
          <div>
            <p className="font-mono text-small font-medium">
              Your subscription is winding down.
            </p>
            <p className="font-mono text-caption text-muted-foreground">
              Paid modules are disabled. Your data is kept; restart a plan to
              re-enable them.
            </p>
          </div>
        </div>
      )}

      {billing && !checkoutReady && (
        <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 font-mono text-caption text-muted-foreground">
          Online checkout is not configured on this deployment yet — no plan is
          changed from this screen. Add the Stripe keys in the Keys / API keys
          settings to enable it.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_CARDS.map((p) => {
          const isCurrent = p.id === currentPlan;
          const cardModules =
            planCatalog?.find((entry) => entry.id === p.id)?.modules ?? [];
          const canBuy =
            p.id !== "free" && configuredPlan(p.id) && Boolean(organizationId);
          return (
            <Card
              key={p.id}
              className={cn(
                "gap-4 py-4",
                isCurrent && "border-terminal-green/60 shadow-pop",
              )}
            >
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2 font-mono text-h3">
                  {p.name}
                  {isCurrent && (
                    <Badge
                      variant="outline"
                      className="border-terminal-green/40 bg-terminal-green-soft font-mono text-caption text-terminal-green"
                    >
                      current
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="font-mono text-caption">
                  {p.blurb}
                </CardDescription>
              </CardHeader>
              <CardContent className="px-4">
                <p className="font-mono text-metric">{p.price}</p>
                <ul className="mt-3 space-y-1">
                  {cardModules.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-1.5 font-mono text-caption text-muted-foreground"
                    >
                      <Check className="size-3 text-terminal-green" /> {m.label}
                    </li>
                  ))}
                </ul>
                <Button
                  className="mt-4 w-full"
                  size="sm"
                  variant={isCurrent ? "outline" : "default"}
                  disabled={isCurrent || busy === p.id || (!selfServe && !canBuy)}
                  onClick={() =>
                    canBuy && !selfServe ? doCheckout(p.id) : doChange(p.id)
                  }
                >
                  {busy === p.id && <Loader2 className="size-4 animate-spin" />}
                  {isCurrent
                    ? "Active"
                    : canBuy
                      ? "Upgrade"
                      : selfServe
                        ? "Switch plan"
                        : "Unavailable"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card">
        <div className="min-w-0">
          <p className="font-mono text-small font-medium">Manage subscription</p>
          <p className="font-mono text-caption text-muted-foreground">
            {checkoutReady
              ? "Update payment method, download invoices or cancel in Stripe."
              : "Drops you to Free. Data is kept until you delete the account."}
          </p>
        </div>
        {checkoutReady ? (
          <Button
            className="ml-auto"
            size="sm"
            variant="outline"
            disabled={!billingState?.hasCustomer || busy === "portal"}
            onClick={doPortal}
          >
            {busy === "portal" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CreditCard className="size-4" />
            )}
            Billing portal
          </Button>
        ) : (
          <Button
            className="ml-auto"
            size="sm"
            variant="outline"
            disabled={currentPlan === "free" || busy === "cancel"}
            onClick={doCancel}
          >
            {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
            Cancel subscription
          </Button>
        )}
      </div>

      {billingState?.dunning && billingState.dunning.length > 0 && (
        <div className="mt-4 rounded-md border bg-card p-4 shadow-card">
          <p className="font-mono text-small font-medium">Open invoices</p>
          <ul className="mt-2 space-y-1">
            {billingState.dunning.map((invoice) => (
              <li
                key={invoice.invoiceId}
                className="flex items-center gap-2 font-mono text-caption"
              >
                <Badge variant="outline" className="font-mono text-caption">
                  {invoice.status}
                </Badge>
                <span>
                  {(invoice.amountDueMinor / 100).toFixed(2)} {invoice.currency}
                </span>
                <span className="text-muted-foreground">
                  attempt {invoice.attemptCount}
                </span>
                {invoice.hostedInvoiceUrl && (
                  <a
                    className="ml-auto underline"
                    href={invoice.hostedInvoiceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Pay invoice
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 rounded-md border border-terminal-red/30 bg-card p-4 shadow-card">
        <p className="font-mono text-small font-medium text-terminal-red">
          Delete account
        </p>
        <p className="mt-0.5 font-mono text-caption text-muted-foreground">
          Permanently removes your account and every project, persona, contact
          and artifact. Cannot be undone.
        </p>
        <div className="mt-3">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="destructive">
                Delete account…
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DeleteAccountBody onConfirm={doDelete} />
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

function DeleteAccountBody({
  onConfirm,
}: {
  onConfirm: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-mono text-h3">
          Delete this account?
        </DialogTitle>
        <DialogDescription className="font-mono text-caption">
          This permanently removes all projects and data. Type DELETE to
          confirm.
        </DialogDescription>
      </DialogHeader>
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="DELETE"
        aria-label="Type DELETE to confirm"
      />
      <DialogFooter>
        <Button variant="ghost" disabled={busy} onClick={() => setText("")}>
          Keep account
        </Button>
        <Button
          variant="destructive"
          disabled={busy || text !== "DELETE"}
          onClick={async () => {
            setBusy(true);
            await onConfirm(text);
            setBusy(false);
          }}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Permanently delete
        </Button>
      </DialogFooter>
    </>
  );
}
