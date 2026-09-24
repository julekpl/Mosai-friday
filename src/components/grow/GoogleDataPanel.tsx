import { useEffect, useId, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Loader2,
  Minus,
  PlugZap,
  RefreshCw,
  Unplug,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ModuleSkeleton, SourceChip, StatusBadge } from "@/components/app/module-kit";
import { cn } from "@/lib/utils";

type Status = NonNullable<FunctionReturnType<typeof api.google.oauth.status>>;
type Connection = NonNullable<Status["connection"]>;
type Overview = NonNullable<FunctionReturnType<typeof api.google.insights.overview>>;
type Kpi = NonNullable<Overview["ga4"]>["kpis"][number];
type ListRow = NonNullable<Overview["gsc"]>["queries"][number];

const SOURCE_LABEL = { ga4: "Google Analytics", gsc: "Search Console", gads: "Google Ads" } as const;

const CALLBACK_ERRORS: Record<string, string> = {
  access_denied: "You cancelled the Google sign-in. Nothing was connected.",
  expired_or_invalid_state: "That Google sign-in link expired. Start again.",
  token_exchange_failed: "Google didn't complete the sign-in. Try again.",
  not_configured: "Google isn't set up on this workspace yet — ask your admin.",
  missing_code: "Google didn't complete the sign-in. Try again.",
};

/* ── Formatting ───────────────────────────────────────────────────────── */

const count = (value: number | undefined) =>
  Math.round(value ?? 0).toLocaleString();
const percent = (value: number | undefined) =>
  `${((value ?? 0) * 100).toFixed(1)}%`;
function money(micros: number | undefined, currency: string | undefined) {
  const amount = (micros ?? 0) / 1_000_000;
  if (!currency) return amount.toFixed(2);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
function formatKpi(kpi: Kpi): string {
  switch (kpi.format) {
    case "rate":
      return percent(kpi.current);
    case "position":
      return kpi.current.toFixed(1);
    case "money":
      return money(kpi.current, kpi.currency);
    default:
      return count(kpi.current);
  }
}
const dateLabel = (value: number) =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/* ── KPI tile ─────────────────────────────────────────────────────────── */

function KpiTile({ kpi }: { kpi: Kpi }) {
  const change = kpi.change;
  // For average position a lower number is better.
  const better = change === null ? null : kpi.format === "position" ? change < 0 : change > 0;
  const flat = change !== null && Math.abs(change) < 0.005;
  const Icon = change === null || flat ? Minus : change > 0 ? ArrowUpRight : ArrowDownRight;
  const changeText =
    change === null
      ? "no earlier data to compare"
      : `${change > 0 ? "+" : ""}${(change * 100).toFixed(0)}% vs previous 28 days`;
  return (
    <div className="rounded-md border bg-card p-4 shadow-card">
      <p className="font-mono text-caption text-muted-foreground">{kpi.label}</p>
      <p className="mt-1 font-mono text-metric">{formatKpi(kpi)}</p>
      <p
        className={cn(
          "mt-1 flex items-center gap-1 font-mono text-caption",
          change === null || flat
            ? "text-muted-foreground"
            : better
              ? "text-terminal-green"
              : "text-terminal-amber",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {changeText}
      </p>
    </div>
  );
}

function KpiRow({ kpis, label }: { kpis: Kpi[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <KpiTile key={kpi.key} kpi={kpi} />
      ))}
    </div>
  );
}

function SimpleTable({
  caption,
  columns,
  rows,
  empty,
}: {
  caption: string;
  columns: Array<{ label: string; numeric?: boolean; render: (row: ListRow) => string }>;
  rows: ListRow[];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="font-mono text-caption text-muted-foreground">{empty}</p>;
  }
  return (
    <Table>
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {columns.map((c) => (
            <TableHead key={c.label} className={cn("font-mono text-caption", c.numeric && "text-right")}>
              {c.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={`${row.key ?? row.label}-${index}`}>
            {columns.map((c, ci) => (
              <TableCell
                key={c.label}
                className={cn(
                  "font-mono text-caption",
                  c.numeric && "text-right tabular-nums",
                  ci === 0 && "max-w-80 truncate",
                )}
                title={ci === 0 ? c.render(row) : undefined}
              >
                {c.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function SectionHeading({ title, syncedAt, period }: { title: string; syncedAt?: number; period?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <h3 className="font-mono text-small font-medium">{title}</h3>
      {period && <span className="font-mono text-caption text-muted-foreground">{period}</span>}
      <SourceChip source="google" asOf={syncedAt} />
    </div>
  );
}

/* ── Insights ─────────────────────────────────────────────────────────── */

function Insights({ projectId, connection }: { projectId: Id<"projects">; connection: Connection }) {
  const overview = useQuery(api.google.insights.overview, { projectId });
  if (overview === undefined) return <ModuleSkeleton label="Loading Google insights…" rows={2} />;
  if (overview === null) return null;
  const { ga4, gsc, gads } = overview;
  const selectedAny =
    connection.selected.ga4PropertyId || connection.selected.gscSiteUrl || connection.selected.adsCustomerId;
  if (!ga4 && !gsc && !gads) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center font-mono text-caption text-muted-foreground">
        {selectedAny
          ? "No numbers yet. Run a sync to bring in the last 28 days."
          : "Pick what to track above, then run a sync to bring in the last 28 days."}
      </p>
    );
  }
  const period = (p?: { periodStart?: string; periodEnd?: string }) =>
    p?.periodStart && p.periodEnd ? `${p.periodStart} → ${p.periodEnd}` : undefined;

  return (
    <div className="grid gap-8">
      {ga4 && (
        <section aria-label="Google Analytics">
          <SectionHeading title="Website visits · Google Analytics" syncedAt={ga4.syncedAt} period={period(ga4)} />
          <KpiRow kpis={ga4.kpis} label="Google Analytics, last 28 days" />
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 font-mono text-caption text-muted-foreground">Top landing pages</p>
              <SimpleTable
                caption="Top landing pages by visits, last 28 days"
                rows={ga4.landingPages}
                empty="No landing pages recorded."
                columns={[
                  { label: "Page", render: (r) => r.label },
                  { label: "Visits", numeric: true, render: (r) => count(r.sessions) },
                  { label: "Key events", numeric: true, render: (r) => count(r.keyEvents) },
                ]}
              />
            </div>
            <div>
              <p className="mb-1 font-mono text-caption text-muted-foreground">Where visits come from</p>
              <SimpleTable
                caption="Visits by channel, last 28 days"
                rows={ga4.channels}
                empty="No channel data recorded."
                columns={[
                  { label: "Channel", render: (r) => r.label },
                  { label: "Visits", numeric: true, render: (r) => count(r.sessions) },
                  { label: "Visitors", numeric: true, render: (r) => count(r.users) },
                ]}
              />
            </div>
          </div>
        </section>
      )}
      {gsc && (
        <section aria-label="Search Console">
          <SectionHeading title="Google Search · Search Console" syncedAt={gsc.syncedAt} period={period(gsc)} />
          <KpiRow kpis={gsc.kpis} label="Search Console, last 28 days" />
          <p className="mt-2 font-mono text-caption text-muted-foreground">
            Google publishes search data with a delay of about two days, so the latest days may be missing.
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <p className="mb-1 font-mono text-caption text-muted-foreground">Top searches</p>
              <SimpleTable
                caption="Top search queries by clicks, last 28 days"
                rows={gsc.queries}
                empty="No searches recorded yet."
                columns={[
                  { label: "Search", render: (r) => r.label },
                  { label: "Clicks", numeric: true, render: (r) => count(r.clicks) },
                  { label: "Shown", numeric: true, render: (r) => count(r.impressions) },
                  { label: "Position", numeric: true, render: (r) => (r.position ?? 0).toFixed(1) },
                ]}
              />
            </div>
            <div>
              <p className="mb-1 font-mono text-caption text-muted-foreground">Top pages in search</p>
              <SimpleTable
                caption="Top pages in Google search by clicks, last 28 days"
                rows={gsc.pages}
                empty="No pages recorded yet."
                columns={[
                  { label: "Page", render: (r) => r.label },
                  { label: "Clicks", numeric: true, render: (r) => count(r.clicks) },
                  { label: "Click rate", numeric: true, render: (r) => percent(r.ctr) },
                ]}
              />
            </div>
          </div>
        </section>
      )}
      {gads && (
        <section aria-label="Google Ads">
          <SectionHeading title="Paid ads · Google Ads" syncedAt={gads.syncedAt} period={period(gads)} />
          <KpiRow kpis={gads.kpis} label="Google Ads, last 28 days" />
          <div className="mt-4">
            <p className="mb-1 font-mono text-caption text-muted-foreground">Campaigns (read-only)</p>
            <SimpleTable
              caption="Google Ads campaigns by spend, last 28 days"
              rows={gads.campaigns}
              empty="No campaigns with activity in the last 28 days."
              columns={[
                { label: "Campaign", render: (r) => r.label },
                { label: "Status", render: (r) => (r.status ?? "unknown").toLowerCase() },
                { label: "Spend", numeric: true, render: (r) => money(r.costMicros, r.currency) },
                { label: "Clicks", numeric: true, render: (r) => count(r.clicks) },
                { label: "Conversions", numeric: true, render: (r) => (r.conversions ?? 0).toFixed(1) },
              ]}
            />
          </div>
        </section>
      )}
    </div>
  );
}

/* ── Pickers ──────────────────────────────────────────────────────────── */

function Picker({
  label,
  value,
  onChange,
  options,
  disabled,
  note,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  disabled?: boolean;
  note?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-mono text-caption text-muted-foreground">
        {label}
      </label>
      <select
        id={id}
        className="h-9 rounded-md border bg-card px-3 font-mono text-small disabled:opacity-60"
        value={value}
        disabled={disabled}
        aria-describedby={note ? noteId : undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Don't track</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      {note && (
        <p id={noteId} className="font-mono text-caption text-muted-foreground">
          {note}
        </p>
      )}
    </div>
  );
}

function ResourcePickers({
  projectId,
  connection,
  adsReady,
}: {
  projectId: Id<"projects">;
  connection: Connection;
  adsReady: boolean;
}) {
  const select = useMutation(api.google.oauth.selectResources);
  const refresh = useAction(api.google.sync.refreshResources);
  const [refreshing, setRefreshing] = useState(false);
  const errorFor = (source: "ga4" | "gsc" | "gads") =>
    connection.resourceErrors.find((e) => e.source === source)?.message;

  const save = async (patch: { ga4PropertyId?: string | null; gscSiteUrl?: string | null; adsCustomerId?: string | null }) => {
    try {
      await select({ projectId, ...patch });
      toast.success("Saved — run a sync to update the numbers.");
    } catch (e) {
      toast.error("Couldn't save that choice", { description: e instanceof Error ? e.message : "Try again." });
    }
  };

  const listing = !connection.resourcesListedAt;
  const noteFor = (source: "ga4" | "gsc" | "gads", empty: boolean, emptyText: string) => {
    if (!connection.granted[source]) return "Not allowed during Google sign-in — reconnect and tick this box to use it.";
    if (source === "gads" && !adsReady) return "Google Ads reporting isn't set up on this workspace yet — ask your admin.";
    const err = errorFor(source);
    if (err) return err;
    if (listing) return "Loading from Google…";
    return empty ? emptyText : undefined;
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Picker
          label="Google Analytics property"
          value={connection.selected.ga4PropertyId ?? ""}
          disabled={!connection.granted.ga4 || connection.ga4Properties.length === 0}
          options={connection.ga4Properties.map((p) => ({
            value: p.id,
            label: p.account ? `${p.name} · ${p.account}` : p.name,
          }))}
          note={noteFor("ga4", connection.ga4Properties.length === 0, "No Google Analytics 4 properties on this Google account.")}
          onChange={(value) => save({ ga4PropertyId: value || null })}
        />
        <Picker
          label="Search Console site"
          value={connection.selected.gscSiteUrl ?? ""}
          disabled={!connection.granted.gsc || connection.gscSites.length === 0}
          options={connection.gscSites.map((s) => ({ value: s.siteUrl, label: s.siteUrl.replace(/^sc-domain:/, "Domain: ") }))}
          note={noteFor("gsc", connection.gscSites.length === 0, "No verified Search Console sites on this Google account.")}
          onChange={(value) => save({ gscSiteUrl: value || null })}
        />
        <Picker
          label="Google Ads account"
          value={connection.selected.adsCustomerId ?? ""}
          disabled={!connection.granted.gads || !adsReady || connection.adsCustomers.length === 0}
          options={connection.adsCustomers.map((c) => ({
            value: c.id,
            disabled: !c.usable,
            label: `${c.name ?? "Account"} · ${c.id.replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3")}${c.manager ? " (manager — pick a client account)" : !c.usable ? " (unavailable)" : ""}`,
          }))}
          note={noteFor("gads", connection.adsCustomers.length === 0, "No Google Ads accounts on this Google account.")}
          onChange={(value) => save({ adsCustomerId: value || null })}
        />
      </div>
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            try {
              const out = await refresh({ projectId });
              if (out.state === "ok") toast.success("Lists updated from Google");
              else if (out.state === "needs_reconnect") toast.error("Google no longer accepts this connection — reconnect Google.");
              else toast.error("Couldn't load your Google accounts. Try again later.");
            } catch (e) {
              toast.error("Couldn't load your Google accounts", { description: e instanceof Error ? e.message : "Try again." });
            } finally {
              setRefreshing(false);
            }
          }}
        >
          {refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Reload lists from Google
        </Button>
      </div>
    </div>
  );
}

/* ── Sync status ──────────────────────────────────────────────────────── */

function SyncStatus({ lastRun }: { lastRun: Status["lastRun"] }) {
  if (!lastRun) {
    return <p className="font-mono text-caption text-muted-foreground">Not synced yet.</p>;
  }
  const busy = lastRun.status === "queued" || lastRun.status === "running";
  const badge =
    lastRun.status === "succeeded"
      ? "done"
      : lastRun.status === "partially_succeeded"
        ? "stale"
        : busy
          ? "pending"
          : lastRun.status;
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          status={badge}
          detail={
            busy
              ? "syncing now"
              : lastRun.status === "partially_succeeded"
                ? "some sources failed"
                : lastRun.status === "succeeded"
                  ? "synced"
                  : undefined
          }
        />
        <span className="font-mono text-caption text-muted-foreground">
          {busy ? "started" : "finished"} {dateLabel(lastRun.finishedAt ?? lastRun.createdAt)}
          {lastRun.trigger === "cron" ? " · daily sync" : ""}
        </span>
      </div>
      {lastRun.message && <p className="font-mono text-caption text-muted-foreground">{lastRun.message}</p>}
      {lastRun.sources.filter((s) => s.status === "failed").map((s) => (
        <p key={s.source} className="flex items-start gap-1.5 font-mono text-caption text-terminal-amber">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {SOURCE_LABEL[s.source]}: {s.message ?? "failed"}
          </span>
        </p>
      ))}
    </div>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────── */

export function GoogleDataPanel({ projectId }: { projectId: Id<"projects"> }) {
  const status = useQuery(api.google.oauth.status, { projectId });
  const start = useMutation(api.google.oauth.start);
  const syncNow = useMutation(api.google.sync.syncNow);
  const disconnect = useAction(api.google.oauth.disconnect);
  const [starting, setStarting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Result of the Google redirect, announced once then removed from the URL.
  useEffect(() => {
    const connected = searchParams.get("google");
    const error = searchParams.get("google_error");
    if (!connected && !error) return;
    if (connected === "connected") toast.success("Google connected. Loading your accounts…");
    if (error) toast.error(CALLBACK_ERRORS[error] ?? "Google sign-in didn't finish. Try again.");
    const next = new URLSearchParams(searchParams);
    next.delete("google");
    next.delete("google_error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const connect = async () => {
    setStarting(true);
    try {
      const out = await start({ projectId });
      if (out.state === "ready" && out.authorizeUrl) {
        window.location.assign(out.authorizeUrl);
        return;
      }
      toast.error(out.message ?? "Google isn't set up on this workspace yet — ask your admin.");
    } catch (e) {
      toast.error("Couldn't start Google sign-in", { description: e instanceof Error ? e.message : "Try again." });
    }
    setStarting(false);
  };

  if (status === undefined) return <ModuleSkeleton label="Loading Google connection…" rows={1} />;
  if (status === null) return null;

  const { setup, connection, lastRun } = status;
  const busy = lastRun?.status === "queued" || lastRun?.status === "running";

  return (
    <section aria-labelledby="google-data-title" className="mb-8 rounded-md border bg-card p-4 shadow-card">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="google-data-title" className="font-mono text-h3">
            Google data
          </h2>
          <p className="font-mono text-caption text-muted-foreground">
            Website visits, Google Search and Google Ads in one place. Read-only — MOSAI never changes anything in your Google accounts.
          </p>
        </div>
        {connection?.status === "connected" && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={syncing || busy}
              onClick={async () => {
                setSyncing(true);
                try {
                  await syncNow({ projectId, requestKey: crypto.randomUUID() });
                  toast.success("Sync started");
                } catch (e) {
                  toast.error("Couldn't start the sync", { description: e instanceof Error ? e.message : "Try again." });
                } finally {
                  setSyncing(false);
                }
              }}
            >
              {syncing || busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {busy ? "Syncing…" : "Sync now"}
            </Button>
            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost">
                  <Unplug className="size-4" /> Disconnect
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle className="font-mono text-h3">Disconnect Google?</DialogTitle>
                  <DialogDescription className="font-mono text-caption">
                    MOSAI will ask Google to revoke its access and delete the numbers it synced. You can connect again any time.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={disconnecting}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={disconnecting}
                    onClick={async () => {
                      setDisconnecting(true);
                      try {
                        const out = await disconnect({ projectId });
                        if (out.revoked) toast.success("Google disconnected");
                        else
                          toast.warning("Disconnected in MOSAI", {
                            description: "Google didn't confirm the revoke. Remove MOSAI in your Google account's security settings to be sure.",
                          });
                        setConfirmOpen(false);
                      } catch (e) {
                        toast.error("Disconnect failed", { description: e instanceof Error ? e.message : "Try again." });
                      } finally {
                        setDisconnecting(false);
                      }
                    }}
                  >
                    {disconnecting && <Loader2 className="size-4 animate-spin" />}
                    Disconnect
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {setup.state === "needs_setup" && !connection ? (
        <div role="status" className="flex items-start gap-2 rounded-md border border-dashed p-4">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-mono text-small font-medium">
              <StatusBadge status="needs_setup" className="mr-2" />
              {setup.message ?? "Google isn't set up on this workspace yet — ask your admin."}
            </p>
            <p className="mt-1 font-mono text-caption text-muted-foreground">
              Once it is, you'll connect Google Analytics, Search Console and Google Ads with one sign-in.
            </p>
          </div>
        </div>
      ) : !connection ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed p-4">
          <p className="font-mono text-caption text-muted-foreground">
            Sign in with Google once to see visits, searches and ad results for the last 28 days.
          </p>
          <Button onClick={connect} disabled={starting}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            Connect Google
          </Button>
        </div>
      ) : connection.status === "needs_reconnect" ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-terminal-amber/40 bg-terminal-amber-soft p-4">
          <p className="flex items-center gap-2 font-mono text-caption">
            <CircleAlert className="size-4 text-terminal-amber" aria-hidden />
            Google no longer accepts this connection (the access was removed or expired). Reconnect to keep your numbers up to date.
          </p>
          <Button onClick={connect} disabled={starting || setup.state === "needs_setup"}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            Reconnect Google
          </Button>
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <CheckCircle2 className="size-4 text-terminal-green" aria-hidden />
            <p className="font-mono text-caption">
              Connected{connection.accountEmail ? ` as ${connection.accountEmail}` : ""}
            </p>
          </div>
          <ResourcePickers projectId={projectId} connection={connection} adsReady={setup.adsState === "ready"} />
          <div aria-live="polite">
            <SyncStatus lastRun={lastRun} />
          </div>
          <Insights projectId={projectId} connection={connection} />
        </div>
      )}
    </section>
  );
}
