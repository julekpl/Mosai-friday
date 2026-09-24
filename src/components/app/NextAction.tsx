import { ArrowRight, CircleDashed, CircleDot, LockKeyhole } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import type { NextActionModel } from "@/components/app/next-action-model";

export function NextAction({ model, projectId }: { model: NextActionModel; projectId: string }) {
  const destination = model.locked
    ? `/app/${projectId}/billing`
    : `/app/${projectId}/${model.module}`;

  return (
    <section aria-labelledby="next-action-title" className="mb-8 grid gap-4 rounded-md border border-terminal-green/30 bg-card p-4 shadow-card md:grid-cols-[minmax(0,1fr)_minmax(15rem,0.8fr)] md:p-5">
      <div className="min-w-0">
        <p className="font-mono text-caption text-muted-foreground">recommended next action</p>
        <h2 id="next-action-title" className="mt-1 font-mono text-h3">{model.title}</h2>
        <p className="mt-2 max-w-prose font-mono text-caption text-muted-foreground">{model.description}</p>
        <Button asChild className="mt-4 w-full sm:w-auto" variant={model.locked ? "outline" : "default"}>
          <Link to={destination}>
            {model.locked ? <LockKeyhole className="size-4" /> : null}
            {model.locked ? "View plan options" : `Open ${model.module === "understand" ? "Understand" : model.module === "journeys" ? "Journeys" : "Create"}`}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
      <div>
        <h3 className="font-mono text-caption font-medium">Setup checklist</h3>
        <ul className="mt-2 grid gap-2">
          {model.steps.map((step) => (
            <li key={step.key} className="flex min-w-0 items-start gap-2 rounded-sm border px-3 py-2">
              {step.state === "saved" ? <CircleDot aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-terminal-green" /> : step.state === "locked" ? <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-terminal-amber" /> : <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
              <span className="min-w-0">
                <span className="block font-mono text-caption">{step.label}{step.state === "locked" ? " · locked" : ""}</span>
                <span className="block font-mono text-caption text-muted-foreground">{step.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 font-mono text-caption text-muted-foreground">Saved work is not marked complete until you review it.</p>
      </div>
    </section>
  );
}
