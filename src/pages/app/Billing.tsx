import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { AlertTriangle, CreditCard, Loader2, Sparkles } from "lucide-react";

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
import type { PlanCatalogEntry } from "@/convex/lib/billingCatalog";
import { CatalogPlans } from "@/components/billing/CatalogPlans";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/app/module-kit";
import { formatMicrousd, type AiBudgetUsage } from "@/convex/lib/aiBudget";

/** `aiBudget.organizationUsage` by name: the reference is typed here so the page does not
 *  depend on regenerated bindings for the new module. */
const aiBudgetUsageQuery = makeFunctionReference<
  "query",
  { organizationId: Id<"organizations"> },
  AiBudgetUsage
>("aiBudget:organizationUsage");

/** Honest AI-spend meter: booked cost plus in-flight reservations against the
 *  plan's monthly budget. Nothing here is an estimate of future use. */
function AiUsageMeter({ organizationId }: { organizationId: Id<"organizations"> | undefined }) {
  const usage = useQuery(aiBudgetUsageQuery, organizationId ? { organizationId } : "skip");
  if (!organizationId || usage === undefined) {
    return (
      <p role="status" className="mb-6 font-mono text-caption text-muted-foreground">
        Loading AI usage…
      </p>
    );
  }
  const used = usage.spentMicrousd + usage.reservedMicrousd;
  const percent = usage.budgetMicrousd > 0 ? Math.min(100, (used / usage.budgetMicrousd) * 100) : 100;
  const resets = new Date(usage.resetsAt).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  const summary = `AI usage this month: ${formatMicrousd(usage.spentMicrousd, usage.currency)} of ${formatMicrousd(usage.budgetMicrousd, usage.currency)}`;
  return (
    <section
      aria-labelledby="ai-usage-heading"
      className="mb-6 rounded-md border bg-card p-4 shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="ai-usage-heading" className="font-mono text-small font-medium">
          {summary}
        </h2>
        {usage.state === "locked" && <StatusBadge status="locked" detail="monthly AI budget reached" />}
        {usage.state !== "locked" && usage.platformPaused && (
          <StatusBadge status="paused" detail="AI is paused for today" />
        )}
      </div>
      <Progress
        className="mt-3"
        value={percent}
        aria-label="AI budget used this month"
        aria-valuetext={summary}
      />
      <p role="status" className="mt-2 font-mono text-caption text-muted-foreground">
        {usage.reservedMicrousd > 0
          ? `${formatMicrousd(usage.reservedMicrousd, usage.currency)} is held for requests still running. `
          : ""}
        {usage.state === "locked"
          ? `AI features are locked until ${resets} (UTC). Upgrade your plan for a larger monthly AI budget.`
          : `Resets on ${resets} (UTC). AI stops when the budget is used up — it never runs over.`}
      </p>
    </section>
  );
}

type BillingCatalog = {
  configured: boolean;
  checkoutReady: boolean;
  portalReady: boolean;
  setupIssue?: string;
  portalSetupIssue?: string;
  mode: "test" | "live" | "unconfigured";
  tax: "calculated_at_checkout";
  plans: PlanCatalogEntry[];
};

/** Plan ids are stable registry keys; paid package names and prices come from Stripe. */
const PLAN_CARDS = [
  { id: "free" },
  { id: "starter" },
  { id: "growth" },
  { id: "scale" },
] as const;

const RETURN_URL = () =>
  typeof window === "undefined" ? "/app/billing" : `${window.location.origin}/app/billing`;

export default function Billing() {
  const billing = useQuery(api.billing.currentPlan);
  const organization = useQuery(api.billing.currentOrganization);
  const deletion = (billing as typeof billing & {
    deletion?: {
      requested: boolean;
      requestedAt: number | null;
      effectiveAt: number | null;
      status: string | null;
      blockedReason: string | null;
      canCancel: boolean;
    };
  } | null | undefined)?.deletion;
  const organizationId = organization?.organizationId;
  const billingState = useQuery(
    api.billing.subscription,
    organizationId ? { organizationId } : "skip",
  );
  const loadCatalog = useAction(api.billing.catalog);
  const cancelDeletion = useMutation(api.billing.cancelAccountDeletion);
  const startCheckout = useAction(api.billing.startCheckout);
  const openPortal = useAction(api.billing.openPortal);
  const cancelSubscription = useAction(api.billing.cancelSubscriptionAtPeriodEnd);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void loadCatalog({})
      .then((result) => {
        if (active) {
          setCatalog(result);
          setCatalogError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setCatalogError(error instanceof Error ? error.message : "Billing catalog is unavailable.");
        }
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadCatalog]);

  // The operator catalog (admin > Plans) drives mix-and-match billing once it
  // has anything to sell; until then the legacy tier grid stays.
  const publicCatalog = useQuery(api.billingPlans.publicCatalog, {});
  const useOperatorCatalog = Boolean(
    publicCatalog &&
      (publicCatalog.plans.some((plan) => plan.priceMinor > 0) || publicCatalog.addons.length > 0),
  );
  const changePlan = useMutation(api.billing.changePlan);
  const deleteAccount = useMutation(api.billing.deleteAccount);
  const [busy, setBusy] = useState<string | null>(null);

  const currentPlan = billingState?.plan ?? billing?.plan ?? "free";
  const selfServe = billing?.selfServePlanChanges ?? false;
  const catalogPlan = (plan: string) =>
    catalog?.plans.find((entry) => entry.plan === plan);
  const configuredPlan = (plan: string) => catalogPlan(plan)?.configured ?? false;
  const checkoutReady = catalog?.checkoutReady ?? false;

  const formatProviderPrice = (entry: PlanCatalogEntry | undefined) => {
    if (!entry?.configured || entry.amountMinor === undefined || !entry.currency) {
      return entry?.plan === "free" ? "Free" : "Price needs setup";
    }
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: entry.currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
    const amount = entry.amountMinor / 10 ** digits;
    const formatted = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: entry.currency,
    }).format(amount);
    const interval = entry.intervalCount && entry.intervalCount > 1
      ? `every ${entry.intervalCount} ${entry.interval}s`
      : `per ${entry.interval ?? "billing interval"}`;
    return `${formatted} ${interval}`;
  };

  const doChange = async (plan: string) => {
    setBusy(plan);
    try {
      await changePlan({ plan: plan as "free" | "starter" | "growth" | "scale" });
      toast.success(`Demo plan switched to ${plan}`, {
        description: "Demo only. No Stripe charge or paid subscription was created.",
      });
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
        expectedPriceId: catalogPlan(plan)?.priceId ?? "",
        expectedAmountMinor: catalogPlan(plan)?.amountMinor ?? -1,
        expectedCurrency: catalogPlan(plan)?.currency ?? "",
      });
      // The plan is NOT granted here: the browser landing on Stripe's success
      // page proves nothing. The verified webhook writes the mirror once Stripe
      // confirms the subscription.
      window.location.assign(url);
    } catch (e) {
      if (e instanceof Error && e.message.includes("catalog changed")) {
        void loadCatalog({}).then((result) => setCatalog(result)).catch(() => undefined);
      }
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
    if (!organizationId) return;
    setBusy("cancel");
    try {
      await cancelSubscription({ organizationId: organizationId as Id<"organizations"> });
      toast.success("Cancellation scheduled for the end of the billing period");
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
      toast.success("Deletion scheduled", {
        description: "Your account remains available during the 30-day grace period.",
      });
    } catch (e) {
      toast.error("Deletion failed", {
        description: e instanceof Error ? e.message : "Try again.",
      });
    }
  };

  const doCancelDeletion = async () => {
    setBusy("deletion-cancel");
    try {
      const result = await cancelDeletion();
      if (result?.canceled) toast.success("Account deletion canceled");
      else toast.error("Deletion can no longer be canceled", { description: result?.reason ?? "Finalization has started." });
    } catch (e) {
      toast.error("Could not cancel deletion", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setBusy(null);
    }
  };

  const doRetryDeletion = async () => {
    setBusy("deletion-retry");
    try {
      await deleteAccount();
      toast.success("Deletion check queued", { description: "The account will be checked again shortly." });
    } catch (e) {
      toast.error("Could not retry deletion", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setBusy(null);
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

      {organization !== null && <AiUsageMeter organizationId={organizationId} />}

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

      {useOperatorCatalog && publicCatalog && organizationId && billingState ? (
        <CatalogPlans
          catalog={publicCatalog}
          organizationId={organizationId}
          checkoutReady={checkoutReady}
          holding={{
            planKey: billingState.planKey,
            activeAddons: billingState.activeAddons,
            hasSubscription: Boolean(
              billingState.subscription &&
                ["active", "trialing", "past_due"].includes(billingState.subscription.status),
            ),
            canManage: billingState.canManage,
          }}
        />
      ) : (
        <>
        {catalogLoading && (
          <p role="status" className="mb-4 font-mono text-caption text-muted-foreground">
            Loading prices…
          </p>
        )}
        {catalogError && (
          <p role="alert" className="mb-4 rounded-md border border-terminal-red/40 bg-card px-3 py-2 font-mono text-caption text-terminal-red">
            Billing prices could not be loaded. {catalogError}
          </p>
        )}

        {billing && !catalogLoading && !catalogError && !checkoutReady && (
          <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 font-mono text-caption text-muted-foreground">
            {catalog?.setupIssue ?? "Billing is not configured on this deployment."}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_CARDS.map((p) => {
            const isCurrent = p.id === currentPlan;
            const price = catalogPlan(p.id);
            const productName = p.id === "free"
              ? "Free"
              : price?.productName ?? "Provider price unavailable";
            const canBuy =
              p.id !== "free" && checkoutReady && configuredPlan(p.id) && Boolean(organizationId);
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
                    {productName}
                    {isCurrent && (
                      <Badge
                        variant="outline"
                        className="border-terminal-green/40 bg-terminal-green-soft font-mono text-caption text-terminal-green"
                      >
                        current
                      </Badge>
                    )}
                  </CardTitle>
                  {price?.configured && price.taxBehavior && (
                    <CardDescription className="font-mono text-caption">
                      {price.taxBehavior === "inclusive"
                        ? "Tax included"
                        : price.taxBehavior === "exclusive"
                          ? "Tax added at checkout"
                          : "Tax calculated at checkout"}
                    </CardDescription>
                  )}
                  {selfServe && (
                    <CardDescription className="font-mono text-caption">
                      Demo only — switching plans here does not create a Stripe subscription or charge.
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="px-4">
                  <p className="font-mono text-metric">{formatProviderPrice(price)}</p>
                  <Button
                    className="mt-4 w-full"
                    size="sm"
                    variant={isCurrent ? "outline" : "default"}
                    aria-busy={busy === p.id}
                    disabled={isCurrent || busy === p.id || catalogLoading || (!selfServe && !canBuy)}
                    onClick={() =>
                      canBuy && !selfServe ? doCheckout(p.id) : doChange(p.id)
                    }
                  >
                    {busy === p.id && <Loader2 className="size-4 animate-spin" />}
                    {busy === p.id
                      ? canBuy && !selfServe ? "Opening checkout…" : "Updating plan…"
                      : isCurrent
                      ? "Active"
                      : canBuy
                        ? "Upgrade"
                        : selfServe
                          ? "Demo switch"
                          : "Unavailable"}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
        </>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3 rounded-md border bg-card p-4 shadow-card">
        <div className="min-w-0">
          <p className="font-mono text-small font-medium">Manage subscription</p>
          <p className="font-mono text-caption text-muted-foreground">
            {billingState?.subscription?.cancelAtPeriodEnd
              ? `Cancellation scheduled for ${billingState.subscription.currentPeriodEnd
                  ? new Date(billingState.subscription.currentPeriodEnd).toLocaleDateString()
                  : "the period end"}. Paid access remains until Stripe confirms the change.`
              : "Cancellation takes effect at the end of the current billing period."}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          aria-busy={busy === "cancel"}
          disabled={
            !checkoutReady || !billingState?.canManage ||
            !["active", "trialing", "past_due"].includes(billingState.subscription?.status ?? "") ||
            billingState.subscription?.cancelAtPeriodEnd === true || busy === "cancel"
          }
          onClick={doCancel}
        >
          {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
          {busy === "cancel"
            ? "Scheduling cancellation…"
            : billingState?.subscription?.cancelAtPeriodEnd
              ? "Cancellation scheduled"
              : "Cancel at period end"}
        </Button>
        {checkoutReady && catalog?.portalReady && (
          <Button
            size="sm"
            variant="outline"
            aria-busy={busy === "portal"}
            disabled={!billingState?.hasCustomer || busy === "portal"}
            onClick={doPortal}
          >
            {busy === "portal" ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            Billing portal
          </Button>
        )}
        {checkoutReady && !catalog?.portalReady && (
          <p role="status" className="font-mono text-caption text-muted-foreground">
            {catalog?.portalSetupIssue ?? "Billing portal is unavailable; invoices remain available below."}
          </p>
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
          Schedules account deletion after a 30-day grace period. You can cancel
          before finalization begins. Paid subscriptions and unresolved shared
          ownership must be resolved before deletion can finish.
        </p>
        {deletion?.requested && (
          <div role="status" className="mt-3 rounded-md border bg-muted/40 p-3 font-mono text-caption">
            <p>Deletion status: {deletion.status}</p>
            {deletion.effectiveAt && <p className="text-muted-foreground">Eligible after {new Date(deletion.effectiveAt).toLocaleString()}</p>}
            {deletion.blockedReason && <p className="mt-1 text-terminal-amber">{deletion.blockedReason}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {deletion.blockedReason?.toLowerCase().includes("subscription") && (
                <Button size="sm" variant="outline" disabled={!billingState?.hasCustomer || busy === "portal"} onClick={doPortal}>
                  Open Stripe billing portal
                </Button>
              )}
              {deletion.status === "waiting_for_user" && (
                <Button size="sm" variant="outline" disabled={busy === "deletion-retry"} onClick={doRetryDeletion}>Retry after resolving</Button>
              )}
              {deletion.canCancel ? (
                <Button size="sm" variant="ghost" disabled={busy === "deletion-cancel"} onClick={doCancelDeletion}>Cancel deletion request</Button>
              ) : (
                <p className="self-center text-muted-foreground">Cancellation is unavailable after finalization begins or the grace period ends.</p>
              )}
            </div>
          </div>
        )}
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
          This schedules account deletion after 30 days. You can cancel during
          the grace period. Type DELETE to confirm the request.
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
          Schedule deletion
        </Button>
      </DialogFooter>
    </>
  );
}
