import {
  ArrowRight,
  Check,
  CircleDashed,
  LockKeyhole,
  PenTool,
  Route,
  Search,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import type { NextActionModel } from "@/components/app/next-action-model";
import { cn } from "@/lib/utils";

/** Presentation for the three setup modules the next action can point at.
 *  Ink tones are the AA-safe `*-ink` tokens (≥ 5.3:1 on their soft tile). */
const STEP_MODULE = {
  understand: {
    label: "Understand",
    icon: Search,
    soft: "bg-tile-teal-soft",
    ink: "text-tile-teal-ink",
  },
  journeys: {
    label: "Journeys",
    icon: Route,
    soft: "bg-tile-sky-soft",
    ink: "text-tile-sky-ink",
  },
  create: {
    label: "Create",
    icon: PenTool,
    soft: "bg-tile-violet-soft",
    ink: "text-tile-violet-ink",
  },
} as const;

/** Plan options live at the workspace-level billing route. */
const PLAN_ROUTE = "/app/billing";

/**
 * The single "next best action" card on the project home.
 *
 * Truth rules: the checklist only says a step has *saved work* (a row
 * exists). It never calls a step complete or verified — that needs the
 * owner's review, which MOSAI does not track yet.
 */
export function NextAction({ model, projectId }: { model: NextActionModel; projectId: string }) {
  const destination = model.locked ? PLAN_ROUTE : `/app/${projectId}/${model.module}`;
  const target = STEP_MODULE[model.module];
  const TargetIcon = model.locked ? LockKeyhole : target.icon;
  const savedCount = model.steps.filter((step) => step.state === "saved").length;

  return (
    <section
      aria-labelledby="next-action-title"
      className="relative grid grid-cols-1 gap-6 overflow-hidden rounded-xl border bg-surface-gradient p-5 shadow-lift md:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.85fr)] md:p-7"
    >
      <div className="flex min-w-0 flex-col">
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full border border-terminal-green/30 bg-terminal-green-soft px-2.5 py-1 font-mono text-caption font-medium text-terminal-green-ink">
          <Sparkles aria-hidden="true" className="size-3.5" />
          Your next best step
        </p>
        <div className="mt-4 flex items-start gap-4">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-lg",
              model.locked ? "bg-terminal-amber-soft text-terminal-amber-ink" : [target.soft, target.ink],
            )}
          >
            <TargetIcon className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 id="next-action-title" className="font-mono text-h2">
              {model.title}
            </h2>
            <p className="mt-2 max-w-prose font-mono text-small text-muted-foreground">
              {model.description}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 md:mt-auto md:pt-6">
          <Button asChild size="lg" variant={model.locked ? "outline" : "default"} className="group w-full sm:w-auto">
            <Link to={destination}>
              {model.locked ? <LockKeyhole aria-hidden="true" className="size-4" /> : null}
              {model.locked ? "View plan options" : `Open ${target.label}`}
              <ArrowRight
                aria-hidden="true"
                className="size-4 transition-transform duration-200 ease-terminal group-hover:translate-x-0.5"
              />
            </Link>
          </Button>
          <p className="font-mono text-caption text-muted-foreground">
            Everything stays a draft until you choose to use it.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <h3 className="font-mono text-small font-semibold">Setup checklist</h3>
          <p className="font-mono text-caption text-muted-foreground">
            {savedCount} of {model.steps.length} with saved work
          </p>
        </div>
        <ol className="mt-3 grid gap-2">
          {model.steps.map((step, index) => {
            const isNext = step.key === model.module;
            return (
              <li
                key={step.key}
                aria-current={isNext ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-start gap-3 rounded-md border px-3 py-2.5",
                  isNext ? "border-terminal-green/40 bg-terminal-green-soft" : "bg-background",
                )}
              >
                <span
                  aria-hidden="true"
                  className={`font-mono text-caption ${cn(
                    "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border font-semibold",
                    step.state === "saved" && "border-terminal-green/50 bg-card text-terminal-green-ink",
                    step.state === "locked" && "border-terminal-amber/50 bg-card text-terminal-amber-ink",
                    step.state === "not_started" && "border-dashed bg-card text-muted-foreground",
                  )}`}
                >
                  {step.state === "saved" ? (
                    <Check className="size-3.5" />
                  ) : step.state === "locked" ? (
                    <LockKeyhole className="size-3" />
                  ) : isNext ? (
                    index + 1
                  ) : (
                    <CircleDashed className="size-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block font-mono text-small font-medium">
                    {step.label}
                    <span className="sr-only">
                      {step.state === "saved"
                        ? " — saved, needs your review"
                        : step.state === "locked"
                          ? " — locked on your plan"
                          : " — not started"}
                    </span>
                  </span>
                  <span className="block font-mono text-caption text-muted-foreground">{step.detail}</span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 font-mono text-caption text-muted-foreground">
          Saved work is not marked complete until you review it.
        </p>
      </div>
    </section>
  );
}
