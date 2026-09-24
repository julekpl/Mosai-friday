import { useState } from "react";
import { useAction } from "convex/react";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CatalogRow = {
  key: string;
  kind: "plan" | "addon";
  name: string;
  description?: string;
  priceMinor: number;
  currency: string;
  interval: "month" | "year";
  trialDays?: number;
  highlights: string[];
  purchasable: boolean;
  modules: Array<{ id: string; label: string }>;
};

export type PublicCatalog = {
  core: Array<{ id: string; label: string }>;
  plans: CatalogRow[];
  addons: CatalogRow[];
};

type Holding = {
  planKey: string;
  activeAddons: Array<{ key: string; source: "stripe" | "operator" }>;
  hasSubscription: boolean;
  canManage: boolean;
};

function formatMinor(amountMinor: number, currency: string): string {
  const digits =
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amountMinor / 10 ** digits);
}

function priceLabel(row: CatalogRow): string {
  if (row.priceMinor === 0) return "Included";
  return `${formatMinor(row.priceMinor, row.currency)} / ${row.interval}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "Try again.";
}

const RETURN_URL = () =>
  typeof window === "undefined" ? "/app/billing" : `${window.location.origin}/app/billing`;

/**
 * Mix-and-match billing from the operator catalog: the core bundle is always
 * included; the customer picks a plan and/or individual tools. New customers
 * build a basket and check out once; existing subscribers add or remove
 * single tools (Stripe prorates). Access changes only when Stripe confirms.
 */
export function CatalogPlans({
  catalog,
  holding,
  organizationId,
  checkoutReady,
}: {
  catalog: PublicCatalog;
  holding: Holding;
  organizationId: Id<"organizations">;
  checkoutReady: boolean;
}) {
  const startCheckout = useAction(api.billing.startCatalogCheckout);
  const addAddon = useAction(api.billing.addAddon);
  const removeAddon = useAction(api.billing.removeAddon);

  const currentPlan = catalog.plans.find((plan) => plan.key === holding.planKey);
  const [planKey, setPlanKey] = useState<string | null>(null);
  const [basket, setBasket] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const heldAddons = new Set(holding.activeAddons.map((addon) => addon.key));
  const selectedPlan = catalog.plans.find((plan) => plan.key === planKey) ?? null;
  const planModules = new Set((selectedPlan ?? currentPlan)?.modules.map((module) => module.id) ?? []);
  const basketRows = catalog.addons.filter((addon) => basket.includes(addon.key));
  const lines = [...(selectedPlan && selectedPlan.priceMinor > 0 ? [selectedPlan] : []), ...basketRows];
  const currency = lines[0]?.currency;
  const mixedCurrency = lines.some((line) => line.currency !== currency);
  const total = lines.reduce((sum, line) => sum + line.priceMinor, 0);

  const toggleBasket = (key: string) =>
    setBasket((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const checkout = async () => {
    setBusy("checkout");
    try {
      const { url } = await startCheckout({
        organizationId,
        planKey: selectedPlan?.key,
        addonKeys: basket,
        expectedLines: lines.map((line) => ({ key: line.key, amountMinor: line.priceMinor, currency: line.currency })),
        successUrl: `${RETURN_URL()}?checkout=success`,
        cancelUrl: `${RETURN_URL()}?checkout=cancelled`,
      });
      window.location.assign(url);
    } catch (error) {
      toast.error("Checkout couldn’t start", { description: errorText(error) });
      setBusy(null);
    }
  };

  const changeAddon = async (row: CatalogRow, add: boolean) => {
    const confirmText = add
      ? `Add ${row.name} for ${priceLabel(row)}? You’ll be charged a prorated amount for the rest of this billing period.`
      : `Remove ${row.name}? You’ll get a prorated credit and lose access to its tools once Stripe confirms.`;
    if (!window.confirm(confirmText)) return;
    setBusy(row.key);
    try {
      if (add) {
        await addAddon({ organizationId, addonKey: row.key, expectedAmountMinor: row.priceMinor, expectedCurrency: row.currency });
      } else {
        await removeAddon({ organizationId, addonKey: row.key });
      }
      toast.success("Sent to Stripe", {
        description: "Your tools update as soon as Stripe confirms the change — usually within a minute.",
      });
    } catch (error) {
      toast.error("Couldn’t change your subscription", { description: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6">
      <section aria-labelledby="core-title" className="rounded-md border bg-card p-4 shadow-card">
        <h2 id="core-title" className="font-mono text-small font-medium">Always included</h2>
        <p className="mt-1 font-mono text-caption text-muted-foreground">
          {catalog.core.map((module) => module.label).join(" · ")} — the foundation every other tool builds on.
        </p>
      </section>

      {catalog.plans.some((plan) => plan.priceMinor > 0) ? (
        <section aria-labelledby="plans-title" className="grid gap-3">
          <h2 id="plans-title" className="font-mono text-h3">Plans</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.plans.map((plan) => {
              const isCurrent = plan.key === holding.planKey;
              const isSelected = plan.key === planKey;
              return (
                <Card key={plan.key} className={cn("gap-3 py-4", (isCurrent || isSelected) && "border-terminal-green/60 shadow-pop")}>
                  <CardHeader className="px-4">
                    <CardTitle className="flex flex-wrap items-center gap-2 font-mono text-h3">
                      {plan.name}
                      {isCurrent ? (
                        <Badge variant="outline" className="font-mono text-caption text-terminal-green">your plan</Badge>
                      ) : null}
                    </CardTitle>
                    {plan.description ? <CardDescription className="font-mono text-caption">{plan.description}</CardDescription> : null}
                  </CardHeader>
                  <CardContent className="grid gap-3 px-4">
                    <p className="font-mono text-metric">{priceLabel(plan)}</p>
                    {plan.trialDays ? <p className="font-mono text-caption text-terminal-green">{plan.trialDays}-day free trial</p> : null}
                    <ul className="grid gap-1" aria-label={`${plan.name} includes`}>
                      {plan.modules.map((module) => (
                        <li key={module.id} className="flex items-center gap-1.5 font-mono text-caption">
                          <Check className="size-3.5 text-terminal-green" aria-hidden="true" /> {module.label}
                        </li>
                      ))}
                      {plan.highlights.map((highlight) => (
                        <li key={highlight} className="font-mono text-caption text-muted-foreground">{highlight}</li>
                      ))}
                    </ul>
                    {!holding.hasSubscription && plan.priceMinor > 0 ? (
                      <Button
                        variant={isSelected ? "default" : "outline"}
                        aria-pressed={isSelected}
                        disabled={!holding.canManage || !plan.purchasable}
                        onClick={() => setPlanKey(isSelected ? null : plan.key)}
                      >
                        {isSelected ? "Selected" : "Choose"}
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {catalog.addons.length ? (
        <section aria-labelledby="addons-title" className="grid gap-3">
          <div>
            <h2 id="addons-title" className="font-mono text-h3">Add tools</h2>
            <p className="font-mono text-caption text-muted-foreground">Pick only what you need. Each tool works on its own and gets better with the others.</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.addons.map((addon) => {
              const coveredByPlan = addon.modules.every((module) => planModules.has(module.id));
              const held = heldAddons.has(addon.key);
              const heldSource = holding.activeAddons.find((item) => item.key === addon.key)?.source;
              const inBasket = basket.includes(addon.key);
              return (
                <li key={addon.key}>
                  <Card className={cn("h-full gap-3 py-4", (held || inBasket) && "border-terminal-green/60")}>
                    <CardHeader className="px-4">
                      <CardTitle className="font-mono text-small">{addon.name}</CardTitle>
                      {addon.description ? <CardDescription className="font-mono text-caption">{addon.description}</CardDescription> : null}
                    </CardHeader>
                    <CardContent className="grid gap-2 px-4">
                      <p className="font-mono text-small font-medium">{priceLabel(addon)}</p>
                      {coveredByPlan ? (
                        <Badge variant="outline" className="w-fit font-mono text-caption text-terminal-green">Included in your plan</Badge>
                      ) : held ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="font-mono text-caption text-terminal-green">
                            {heldSource === "operator" ? "Active (granted)" : "Active"}
                          </Badge>
                          {heldSource === "stripe" && holding.canManage ? (
                            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => changeAddon(addon, false)}>
                              {busy === addon.key ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Minus className="size-3.5" aria-hidden="true" />}
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      ) : holding.hasSubscription ? (
                        <Button
                          size="sm"
                          disabled={!holding.canManage || !addon.purchasable || !checkoutReady || busy !== null}
                          onClick={() => changeAddon(addon, true)}
                        >
                          {busy === addon.key ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                          Add to subscription
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant={inBasket ? "default" : "outline"}
                          aria-pressed={inBasket}
                          disabled={!holding.canManage || !addon.purchasable}
                          onClick={() => toggleBasket(addon.key)}
                        >
                          {inBasket ? <Check className="size-3.5" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                          {inBasket ? "Added" : "Add"}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {!holding.hasSubscription && lines.length ? (
        <section aria-labelledby="basket-title" className="sticky bottom-3 z-10 grid gap-2 rounded-md border bg-card p-4 shadow-pop">
          <h2 id="basket-title" className="font-mono text-small font-medium">Your selection</h2>
          <ul className="grid gap-1">
            {lines.map((line) => (
              <li key={line.key} className="flex justify-between gap-2 font-mono text-caption">
                <span>{line.name}</span>
                <span>{priceLabel(line)}</span>
              </li>
            ))}
          </ul>
          {mixedCurrency ? (
            <p role="alert" className="font-mono text-caption text-terminal-red">These items use different currencies and can’t be bought together.</p>
          ) : (
            <p className="font-mono text-small font-medium">
              Total {currency ? formatMinor(total, currency) : ""} per billing period · tax calculated at checkout
            </p>
          )}
          <Button
            className="w-fit"
            disabled={!checkoutReady || mixedCurrency || busy !== null || !holding.canManage}
            onClick={checkout}
          >
            {busy === "checkout" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Continue to secure checkout
          </Button>
          {!checkoutReady ? (
            <p className="font-mono text-caption text-muted-foreground">Payments aren’t switched on yet on this workspace.</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
