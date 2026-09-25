import {
  ArrowRight,
  Check,
  CircleDashed,
  Globe,
  LockKeyhole,
  Megaphone,
  Phone,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/app/module-kit";
import type {
  ActionTarget,
  ChecklistItem,
  NextActionModel,
  OutcomeKey,
} from "@/components/app/next-action-model";
import { cn } from "@/lib/utils";

/** Presentation per outcome. Ink tones are the AA-safe `*-ink` tokens. */
const OUTCOME = {
  website: { icon: Globe, soft: "bg-tile-sky-soft", ink: "text-tile-sky-ink" },
  posts: { icon: Megaphone, soft: "bg-tile-coral-soft", ink: "text-tile-coral-ink" },
  contact: { icon: Phone, soft: "bg-tile-teal-soft", ink: "text-tile-teal-ink" },
  results: { icon: TrendingUp, soft: "bg-tile-lime-soft", ink: "text-tile-lime-ink" },
  done: { icon: Check, soft: "bg-terminal-green-soft", ink: "text-terminal-green-ink" },
} as const satisfies Record<OutcomeKey, unknown>;

/** Plan options live at the workspace-level billing route. */
const PLAN_ROUTE = "/app/billing";

function routeFor(target: ActionTarget | "understand" | "journeys", projectId: string): string {
  return target === "billing" ? PLAN_ROUTE : `/app/${projectId}/${target}`;
}

const CHECKLIST_SR: Record<ChecklistItem["state"], string> = {
  next: " — your next step",
  to_do: " — to do",
  has_record: " — saved",
  locked: " — not on your plan",
};

/**
 * The single "This week" next step on the project home.
 *
 * One action per state. The checklist marks an outcome only from what the
 * server stored (hosting status, post receipts, saved contact details, the
 * Google connection); it never says "complete" or "verified".
 */
export function NextAction({ model, projectId }: { model: NextActionModel; projectId: string }) {
  const outcome = OUTCOME[model.key];
  const Icon = model.locked ? LockKeyhole : outcome.icon;
  const quiet = model.action.emphasis === "quiet";

  return (
    <section
      aria-labelledby="next-action-title"
      className="relative grid grid-cols-1 gap-6 overflow-hidden rounded-xl border bg-surface-gradient p-5 shadow-lift md:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)] md:p-7"
    >
      <div className="flex min-w-0 flex-col">
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-terminal-green/30 bg-terminal-green-soft px-2.5 py-1 font-mono text-caption font-medium text-terminal-green-ink">
          <Sparkles aria-hidden="true" className="size-3.5" />
          This week
        </p>
        <div className="mt-4 flex items-start gap-4">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-lg",
              model.locked ? "bg-terminal-amber-soft text-terminal-amber-ink" : [outcome.soft, outcome.ink],
            )}
          >
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 id="next-action-title" className="break-words font-mono text-h2">
              {model.title}
            </h2>
            {model.status ? (
              <StatusBadge className="mt-2" status={model.status.status} detail={model.status.detail} />
            ) : null}
            <p className="mt-2 max-w-prose font-mono text-small text-muted-foreground">{model.description}</p>
            {model.why.length > 0 ? (
              <ul aria-label="Why this step" className="mt-3 grid gap-1 font-mono text-caption text-muted-foreground">
                {model.why.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 md:mt-auto md:pt-6">
          <Button
            asChild
            size="lg"
            variant={quiet ? "ghost" : model.locked ? "outline" : "default"}
            className="group min-h-11 w-full sm:w-auto"
          >
            <Link to={routeFor(model.action.target, projectId)}>
              {model.locked ? <LockKeyhole aria-hidden="true" className="size-4" /> : null}
              {model.action.label}
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform duration-200 ease-terminal group-hover:translate-x-0.5"
              />
            </Link>
          </Button>
        </div>
        {model.deeper.length > 0 ? (
          <nav aria-label="Go deeper" className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="font-mono text-caption text-muted-foreground">Go deeper:</span>
            {model.deeper.map((link) => (
              <Link
                key={link.target}
                to={routeFor(link.target, projectId)}
                className="focus-ring inline-flex min-h-11 items-center rounded-sm font-mono text-caption text-foreground underline underline-offset-4"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h3 className="font-mono text-small font-semibold">Your week at a glance</h3>
        <ol className="mt-3 grid gap-2">
          {model.checklist.map((item, index) => {
            const isNext = item.state === "next";
            return (
              <li
                key={item.key}
                aria-current={isNext ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-start gap-3 rounded-md border px-3 py-2.5",
                  isNext ? "border-terminal-green/40 bg-terminal-green-soft" : "bg-background",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border font-mono text-caption font-semibold",
                    item.state === "has_record" && "border-terminal-green/50 bg-card text-terminal-green-ink",
                    item.state === "locked" && "border-terminal-amber/50 bg-card text-terminal-amber-ink",
                    (item.state === "to_do" || isNext) && "border-dashed bg-card text-muted-foreground",
                  )}
                >
                  {item.state === "has_record" ? (
                    <Check className="size-3.5" />
                  ) : item.state === "locked" ? (
                    <LockKeyhole className="size-3" />
                  ) : isNext ? (
                    index + 1
                  ) : (
                    <CircleDashed className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-small font-medium">
                    {item.label}
                    <span className="sr-only">{CHECKLIST_SR[item.state]}</span>
                  </span>
                  <span className="block break-words font-mono text-caption text-muted-foreground">{item.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
