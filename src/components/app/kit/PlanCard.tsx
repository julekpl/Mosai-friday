import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { StarterKitPart } from "@/shared/starterKit";
import type { StarterKitPlan } from "@/shared/starterKitJob";
import { KitPartCard } from "@/components/app/kit/KitPartCard";

/** Where a point came from, in the owner's words. */
function basisLabel(basis: "fact" | "assumption"): string {
  return basis === "fact" ? "from your website" : "our guess";
}

function BasisTag({ basis }: { basis: "fact" | "assumption" }) {
  return (
    <span className="ml-1 rounded-sm bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">
      {basisLabel(basis)}
    </span>
  );
}

function PlanDialog({
  plan,
  onFixFacts,
  primary,
}: {
  plan: StarterKitPlan;
  onFixFacts: () => void;
  /** Quieter button when fixing a gap comes first. */
  primary: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={primary ? "default" : "outline"} className="min-h-11">
          Read it (1 min)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your plan</DialogTitle>
          <DialogDescription>
            Each point says whether it comes from your website or is our guess. Fix anything that is wrong.
          </DialogDescription>
        </DialogHeader>

        <section aria-labelledby="kit-plan-customers" className="grid gap-2">
          <h4 id="kit-plan-customers" className="text-body font-semibold">
            Your customers (our guess)
          </h4>
          <ul className="grid list-disc gap-1 pl-5 text-small">
            {plan.customers.map((customer, index) => (
              <li key={index}>
                {customer.text}
                <BasisTag basis={customer.basis} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="kit-plan-week" className="grid gap-2">
          <h4 id="kit-plan-week" className="text-body font-semibold">
            This week
          </h4>
          <ol className="grid list-decimal gap-3 pl-5 text-small">
            {plan.thisWeek.map((step, index) => (
              <li key={index}>
                <p className="font-medium">{step.action}</p>
                <p className="text-muted-foreground">
                  Why: {step.why}
                  <BasisTag basis={step.basis} />
                </p>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            onClick={() => {
              // One sheet at a time: close the plan, then open Edit project.
              setOpen(false);
              onFixFacts();
            }}
          >
            Fix the facts
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PlanCard({
  part,
  plan,
  onFixFacts,
  onRetry,
  retrying,
}: {
  part: StarterKitPart;
  plan: StarterKitPlan | null | undefined;
  onFixFacts: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const fixFacts = (
    <Button variant="outline" className="min-h-11" onClick={onFixFacts}>
      Fix the facts
    </Button>
  );
  return (
    <KitPartCard
      name="plan"
      part={part}
      onRetry={onRetry}
      retrying={retrying}
      result={
        plan === null ? (
          <p className="text-small text-muted-foreground">We could not open your plan. Fix the facts and try again.</p>
        ) : plan ? (
          <p className="text-small text-muted-foreground">
            Who your customers are, and three things to do this week.
          </p>
        ) : null
      }
      actions={
        <>
          {plan ? <PlanDialog plan={plan} onFixFacts={onFixFacts} primary /> : null}
          {fixFacts}
        </>
      }
      fixAction={
        <>
          <Button className="min-h-11" onClick={onFixFacts}>
            Fix the facts
          </Button>
          {plan ? <PlanDialog plan={plan} onFixFacts={onFixFacts} primary={false} /> : null}
        </>
      }
    />
  );
}

