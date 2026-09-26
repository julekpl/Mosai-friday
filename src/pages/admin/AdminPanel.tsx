import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toast } from "sonner";
import {
  Activity,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users as UsersIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AiModelsTab } from "./AiModelsTab";
import { LimitsTab } from "./LimitsTab";
import { OrganizationAddonsDialog, PlansTab } from "./PlansTab";

const PLAN_IDS = ["free", "starter", "growth", "scale"] as const;

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="px-4">
        <CardDescription className="font-mono text-caption">
          {label}
        </CardDescription>
        <CardTitle className="font-mono text-metric">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="px-4">
          <p className="font-mono text-caption text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  );
}

export default function AdminPanel() {
  const me = useQuery(api.admin.me);
  const overview = useQuery(api.admin.overview);
  const config = useQuery(api.admin.billingConfig);
  const reconciliation = useQuery(api.admin.reconciliation, {});
  const events = useQuery(api.admin.billingEvents, { limit: 40 });
  const organizations = useQuery(api.admin.organizations, { limit: 100 });
  const users = useQuery(api.admin.users, { limit: 100 });
  const auditLog = useQuery(api.admin.auditLog, { limit: 40 });
  const requestReconciliation = useMutation(api.admin.requestReconciliation);
  const setUserOperator = useMutation(api.admin.setUserOperator);

  if (me === undefined) {
    return (
      <p className="font-mono text-caption text-muted-foreground">checking…</p>
    );
  }

  if (!me.isAdmin) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-terminal-amber/40 bg-card p-8 text-center shadow-card">
        <ShieldAlert className="mx-auto size-8 text-terminal-amber" />
        <h1 className="mt-3 font-mono text-h2">Operator access required</h1>
        <p className="mt-2 font-mono text-caption text-muted-foreground">
          {me.email ?? "This account"} is not a MOSAI platform operator. Ask an
          existing operator to grant access, or add the address to the
          deployment&apos;s operator allow-list.
        </p>
      </div>
    );
  }

  const latestDrifts = reconciliation?.latest?.drifts ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md border bg-card shadow-card">
          <ShieldCheck className="size-5 text-terminal-green" />
        </span>
        <div>
          <h1 className="font-mono text-h1">Platform admin</h1>
          <p className="font-mono text-caption text-muted-foreground">
            Signed in as {me.email ?? "operator"} · full cross-tenant access
          </p>
        </div>
        <Badge variant="outline" className="ml-auto font-mono text-caption">
          {me.isAdmin ? "operator" : "viewer"}
        </Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="accounts"
          value={overview?.users ?? "…"}
          hint={overview?.usersCapped ? "capped at 5,000" : undefined}
        />
        <Stat label="organizations" value={overview?.organizations ?? "…"} />
        <Stat label="projects" value={overview?.projects ?? "…"} />
        <Stat
          label="current subscription sample"
          value={overview?.subscriptions ?? "…"}
          hint={
            overview
              ? [
                  overview.subscriptionsCapped
                    ? "capped at 5,000 rows"
                    : "all current rows",
                  `${overview.activeSubscriptions} active`,
                  `${overview.pastDue} past due`,
                ].join(" · ")
              : undefined
          }
        />
      </div>

      <Tabs defaultValue="billing" className="mt-8">
        <TabsList>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
          <TabsTrigger value="plans">Plans & add-ons</TabsTrigger>
          <TabsTrigger value="ai-models">AI models</TabsTrigger>
          <TabsTrigger value="limits">Limits</TabsTrigger>
        </TabsList>

        <TabsContent value="plans" className="mt-4">
          <PlansTab />
        </TabsContent>

        <TabsContent value="ai-models" className="mt-4">
          <AiModelsTab />
        </TabsContent>

        <TabsContent value="limits" className="mt-4">
          <LimitsTab />
        </TabsContent>

        <TabsContent value="billing" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 font-mono text-h3">
                <Activity className="size-4 text-terminal-green" /> Stripe
                configuration
              </CardTitle>
              <CardDescription className="font-mono text-caption">
                Truth lives in Stripe. Nothing here marks a plan paid — only a
                verified webhook does.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="font-mono text-caption">
                  mode: {config?.mode ?? "…"}
                </Badge>
                <Badge variant="outline" className="font-mono text-caption">
                  checkout: {config?.checkoutConfigured ? "ready" : "needs_setup"}
                </Badge>
                <Badge variant="outline" className="font-mono text-caption">
                  webhook secret:{" "}
                  {config?.webhookSecretConfigured ? "set" : "needs_setup"}
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {config?.plans.map((plan) => (
                  <div
                    key={plan.plan}
                    className="rounded-sm border bg-muted/30 px-3 py-2"
                  >
                    <p className="font-mono text-small">{plan.plan}</p>
                    <p className="font-mono text-caption text-muted-foreground">
                      {plan.configured ? "price configured" : "no price id"}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 font-mono text-h3">
                {reconciliation?.latest?.driftCount === 0 ? (
                  <CheckCircle2 className="size-4 text-terminal-green" />
                ) : (
                  <ShieldAlert className="size-4 text-terminal-amber" />
                )}
                Reconciliation
                <Badge variant="outline" className="ml-auto font-mono text-caption">
                  {reconciliation?.latest
                    ? `drift ${reconciliation.latest.driftCount}`
                    : "no run yet"}
                </Badge>
              </CardTitle>
              <CardDescription className="font-mono text-caption">
                Target: 0 drift between the local mirror and Stripe.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await requestReconciliation();
                    toast.success("Reconciliation scheduled");
                  } catch (error) {
                    toast.error("Could not schedule", {
                      description:
                        error instanceof Error ? error.message : "Try again.",
                    });
                  }
                }}
              >
                <RefreshCw className="size-4" /> Run now
              </Button>
              {latestDrifts.length > 0 && (
                <ul className="space-y-1">
                  {latestDrifts.slice(0, 10).map((drift, index) => (
                    <li
                      key={index}
                      className="rounded-sm border border-terminal-amber/40 bg-card px-3 py-1.5 font-mono text-caption"
                    >
                      <span className="text-terminal-amber">{drift.kind}</span>{" "}
                      {drift.detail}
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-1">
                {reconciliation?.runs.map((run) => (
                  <p
                    key={run._id}
                    className="font-mono text-caption text-muted-foreground"
                  >
                    {new Date(run.finishedAt).toISOString()} · {run.source} ·{" "}
                    {run.checked} checked · drift {run.driftCount}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4">
              <CardTitle className="font-mono text-h3">
                Webhook ledger
              </CardTitle>
              <CardDescription className="font-mono text-caption">
                Duplicate and out-of-order deliveries change nothing.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <div className="max-h-72 overflow-y-auto">
                {(events ?? []).map((event) => (
                  <div
                    key={event._id}
                    className="flex items-center gap-2 border-b py-1.5 font-mono text-caption last:border-0"
                  >
                    <Badge
                      variant="outline"
                      className="font-mono text-caption"
                    >
                      {event.status}
                    </Badge>
                    <span className="truncate">{event.type}</span>
                    <span className="ml-auto shrink-0 text-muted-foreground">
                      {new Date(event.created * 1000).toISOString().slice(0, 19)}
                    </span>
                  </div>
                ))}
                {events && events.length === 0 && (
                  <p className="font-mono text-caption text-muted-foreground">
                    No webhook deliveries yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organizations" className="mt-4">
          <Card>
            <CardHeader className="px-4">
              <CardTitle className="font-mono text-h3">Organizations</CardTitle>
              <CardDescription className="font-mono text-caption">
                Support overrides write the plan mirror directly and are
                audited.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <div className="space-y-2">
                {(organizations ?? []).map((org) => (
                  <div
                    key={org._id}
                    className="flex flex-wrap items-center gap-2 rounded-sm border bg-card px-3 py-2"
                  >
                    <span className="font-mono text-small">{org.name}</span>
                    <Badge variant="outline" className="font-mono text-caption">
                      {org.kind}
                    </Badge>
                    <span className="font-mono text-caption text-muted-foreground">
                      {org.ownerEmail ?? "—"}
                    </span>
                    <Badge variant="outline" className="font-mono text-caption">
                      {org.plan} · {org.planStatus}
                    </Badge>
                    <span className="font-mono text-caption text-muted-foreground">
                      {org.members} members
                    </span>
                    <div className="ml-auto">
                      <div className="flex flex-wrap gap-1">
                        <PlanOverrideDialog organizationId={org._id} current={org.plan} />
                        <OrganizationAddonsDialog organizationId={org._id} organizationName={org.name} />
                      </div>
                    </div>
                  </div>
                ))}
                {organizations && organizations.length === 0 && (
                  <p className="font-mono text-caption text-muted-foreground">
                    No organizations yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <Card>
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 font-mono text-h3">
                <UsersIcon className="size-4 text-terminal-green" /> Accounts
              </CardTitle>
              <CardDescription className="font-mono text-caption">
                Grant or revoke platform operator access. Revoking your own is
                refused.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <div className="space-y-2">
                {(users ?? []).map((user) => (
                  <div
                    key={user._id}
                    className="flex flex-wrap items-center gap-2 rounded-sm border bg-card px-3 py-2"
                  >
                    <span className="font-mono text-small">
                      {user.email ?? user.name ?? user._id}
                    </span>
                    <Badge variant="outline" className="font-mono text-caption">
                      {user.plan} · {user.planStatus}
                    </Badge>
                    {user.isPlatformAdmin && (
                      <Badge
                        variant="outline"
                        className="border-terminal-green/40 font-mono text-caption text-terminal-green"
                      >
                        operator
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={async () => {
                        try {
                          await setUserOperator({
                            userId: user._id,
                            enabled: !user.isPlatformAdmin,
                          });
                          toast.success(
                            user.isPlatformAdmin
                              ? "Operator access revoked"
                              : "Operator access granted",
                          );
                        } catch (error) {
                          toast.error("Could not update", {
                            description:
                              error instanceof Error
                                ? error.message
                                : "Try again.",
                          });
                        }
                      }}
                    >
                      {user.isPlatformAdmin ? "Revoke" : "Grant"}
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader className="px-4">
              <CardTitle className="font-mono text-h3">Operator audit</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <div className="space-y-1">
                {(auditLog ?? []).map((entry) => (
                  <div
                    key={entry._id}
                    className="border-b py-1.5 font-mono text-caption last:border-0"
                  >
                    <span className="text-terminal-green">{entry.action}</span> ·{" "}
                    {entry.actorEmail ?? entry.actorId} ·{" "}
                    {new Date(entry.createdAt).toISOString().slice(0, 19)}
                    {entry.detail ? ` · ${entry.detail}` : ""}
                  </div>
                ))}
                {auditLog && auditLog.length === 0 && (
                  <p className="font-mono text-caption text-muted-foreground">
                    No operator actions recorded yet.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PlanOverrideDialog({
  organizationId,
  current,
}: {
  organizationId: Id<"organizations">;
  current: string;
}) {
  const updatePlan = useMutation(api.admin.setOrganizationPlan);
  const catalog = useQuery(api.billingPlans.adminList, {});
  const catalogPlans = (catalog?.rows ?? []).filter(
    (row) => row.kind === "plan" && row.status !== "draft" && !(PLAN_IDS as readonly string[]).includes(row.key),
  );
  const [plan, setPlan] = useState<string>(current || "free");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Override
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-h3">Set plan</DialogTitle>
          <DialogDescription className="font-mono text-caption">
            This writes the plan mirror directly (a comp or a fix). It is not a
            payment and is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="font-mono text-caption">Plan</Label>
            <select
              className="mt-1 w-full rounded-sm border bg-background px-2 py-1.5 font-mono text-small"
              value={plan}
              onChange={(event) => setPlan(event.target.value)}
              aria-label="Plan"
            >
              {PLAN_IDS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
              {catalogPlans.map((row) => (
                <option key={row.key} value={row.key}>
                  {row.name} ({row.key})
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="override-reason" className="font-mono text-caption">
              Reason
            </Label>
            <Input
              id="override-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. refund goodwill, ticket #123"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await updatePlan({ organizationId, plan, reason: reason.trim() });
                toast.success("Plan updated");
              } catch (error) {
                toast.error("Could not update", {
                  description:
                    error instanceof Error ? error.message : "Try again.",
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
