import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { formatMicrousd } from "@/convex/lib/aiBudget";
import type { LimitKey, LimitSource } from "@/convex/lib/platformLimits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Unit = "calls" | "usd";

type LimitView = {
  key: LimitKey;
  value: number;
  source: LimitSource;
  defaultValue: number;
  max: number;
  adminValue: number | null;
};

const SOURCE_LABEL: Record<LimitSource, string> = {
  admin: "set here",
  env: "deployment setting",
  default: "default",
  kill_switch: "stopped by deployment switch",
};

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0]
    : "Try again.";
}

function display(value: number, unit: Unit): string {
  return unit === "usd" ? formatMicrousd(value) : value.toLocaleString("en-US");
}

/** Dollars typed by the operator → integer micro-USD (AGENTS.md §5.7). */
function toStored(raw: string, unit: Unit): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (unit === "usd") {
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    return Math.round(Number(trimmed) * 100) * 10_000;
  }
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

function LimitField({
  view,
  label,
  help,
  unit,
  used,
  onSave,
}: {
  view: LimitView;
  label: string;
  help: string;
  unit: Unit;
  used?: string;
  onSave: (value: number | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = `limit-${view.key}`;
  const helpId = `${inputId}-help`;

  const save = async (value: number | null) => {
    setBusy(true);
    try {
      await onSave(value);
      setDraft("");
    } catch {
      // The caller already showed the error; keep the draft so it can be fixed.
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = toStored(draft, unit);
    if (value === null) {
      toast.error(unit === "usd" ? "Enter an amount like 1 or 2.50" : "Enter a whole number");
      return;
    }
    void save(value);
  };

  return (
    <div className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label htmlFor={inputId} className="font-mono text-small font-medium">
          {label}
        </Label>
        <p className="font-mono text-small">
          {display(view.value, unit)}{" "}
          <Badge variant="outline" className="ml-1 font-mono text-caption">
            {SOURCE_LABEL[view.source]}
          </Badge>
        </p>
      </div>
      <p id={helpId} className="font-mono text-caption text-muted-foreground">
        {help} Default {display(view.defaultValue, unit)}.{used ? ` ${used}` : ""}
      </p>
      <form className="flex flex-wrap gap-2" onSubmit={submit}>
        <Input
          id={inputId}
          inputMode={unit === "usd" ? "decimal" : "numeric"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={unit === "usd" ? "Amount in US$" : "Number"}
          aria-describedby={helpId}
          className="min-h-11 max-w-40"
        />
        <Button type="submit" className="min-h-11" disabled={busy || draft.trim() === ""}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Save
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={busy || view.adminValue === null}
          onClick={() => void save(null)}
        >
          Use default
        </Button>
      </form>
    </div>
  );
}

function UsageSync({
  kind,
  label,
  current,
}: {
  kind: "serpapi" | "pexels";
  label: string;
  current: number;
}) {
  const setCount = useMutation(api.admin.setProviderUsageCount);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputId = `usage-${kind}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const count = toStored(draft, "calls");
    if (count === null) {
      toast.error("Enter a whole number");
      return;
    }
    setBusy(true);
    try {
      await setCount({ kind, count });
      toast.success("Usage updated");
      setDraft("");
    } catch (error) {
      toast.error("Couldn’t update usage", { description: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="space-y-2 border-t pt-3" onSubmit={submit}>
      <Label htmlFor={inputId} className="font-mono text-small font-medium">
        Match the {label} dashboard
      </Label>
      <p id={`${inputId}-help`} className="font-mono text-caption text-muted-foreground">
        MOSAI counts only its own calls ({current.toLocaleString("en-US")} this month). If your {label} dashboard
        shows more, enter that number so the limit stops at the right point.
      </p>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Used this month"
          aria-describedby={`${inputId}-help`}
          className="min-h-11 max-w-40"
        />
        <Button type="submit" variant="outline" className="min-h-11" disabled={busy || draft.trim() === ""}>
          Set usage
        </Button>
      </div>
    </form>
  );
}

/**
 * Operator view of the spending limits (owner ask, 26 Sep 2026). Each value
 * saved here wins over the deployment environment variable; "Use default"
 * removes it. Enforcement lives on the server (`lib/platformLimits.ts`).
 */
export function LimitsTab() {
  const data = useQuery(api.admin.limits, {});
  const setLimits = useMutation(api.admin.setLimits);

  if (data === undefined) {
    return (
      <p className="flex items-center gap-2 font-mono text-caption text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading…
      </p>
    );
  }

  const view = (key: LimitKey) => data.limits.find((limit) => limit.key === key) as LimitView;
  const save = (key: LimitKey) => async (value: number | null) => {
    try {
      await setLimits({ changes: { [key]: value } });
      toast.success(value === null ? "Limit reset to default" : "Limit saved");
    } catch (error) {
      toast.error("Couldn’t save the limit", { description: errorText(error) });
      throw error;
    }
  };
  const serpapiCeiling = view("serpapiMonthlyCeiling").value;
  const pexelsCeiling = view("pexelsMonthlyCeiling").value;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="px-4">
          <CardTitle className="font-mono text-h3">Business search (SerpApi)</CardTitle>
          <CardDescription className="font-mono text-caption">
            Used {data.usage.serpapiThisMonth.toLocaleString("en-US")} of {serpapiCeiling.toLocaleString("en-US")} this
            month ({data.month}, UTC). At the limit, owners see “Business search is resting” and can type their details
            instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y px-4">
          <LimitField
            view={view("serpapiMonthlyCeiling")}
            label="Monthly limit for all of MOSAI"
            help="Set a little below your SerpApi plan’s monthly searches."
            unit="calls"
            onSave={save("serpapiMonthlyCeiling")}
          />
          <LimitField
            view={view("serpapiUserDailyCap")}
            label="Per person per day"
            help="Stops one account using up the month."
            unit="calls"
            onSave={save("serpapiUserDailyCap")}
          />
          <UsageSync kind="serpapi" label="SerpApi" current={data.usage.serpapiThisMonth} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4">
          <CardTitle className="font-mono text-h3">AI spending</CardTitle>
          <CardDescription className="font-mono text-caption">
            Daily limits reset at midnight UTC. Nothing is generated or charged once a limit is reached.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y px-4">
          <LimitField
            view={view("aiPlatformDailyMicrousd")}
            label="All of MOSAI per day"
            help="The overall safety stop for every AI feature."
            unit="usd"
            used={`Used today: ${formatMicrousd(data.usage.aiPlatformTodayMicrousd)}.`}
            onSave={save("aiPlatformDailyMicrousd")}
          />
          <LimitField
            view={view("aiTrialDailyMicrousd")}
            label="Trial accounts per day"
            help="Shared by every organization on a trial."
            unit="usd"
            used={`Used today: ${formatMicrousd(data.usage.aiTrialTodayMicrousd)}.`}
            onSave={save("aiTrialDailyMicrousd")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="px-4">
          <CardTitle className="font-mono text-h3">Stock photos (Pexels)</CardTitle>
          <CardDescription className="font-mono text-caption">
            Used {data.usage.pexelsThisMonth.toLocaleString("en-US")} of {pexelsCeiling.toLocaleString("en-US")} this
            month.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y px-4">
          <LimitField
            view={view("pexelsMonthlyCeiling")}
            label="Monthly limit for all of MOSAI"
            help="Pexels is free but rate-limited."
            unit="calls"
            onSave={save("pexelsMonthlyCeiling")}
          />
          <UsageSync kind="pexels" label="Pexels" current={data.usage.pexelsThisMonth} />
        </CardContent>
      </Card>
    </div>
  );
}
