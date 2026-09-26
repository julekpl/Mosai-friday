import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import type { BusinessType, CustomerGroup, PostingChannel, PrimaryGoal } from "@/shared/starterKit";
import { MultiChoiceTiles } from "@/components/app/wizard/MultiChoiceTiles";
import { AnythingElseNote, OtherNote } from "@/components/app/wizard/OtherNote";
import {
  BUSINESS_TYPE_OPTIONS,
  CHANNEL_OPTIONS,
  CUSTOMER_OPTIONS,
  GOAL_OPTIONS,
  businessTypeLabel,
} from "@/components/app/wizard/questionOptions";
import {
  EXCLUSIVE_CHANNELS,
  fromStored,
  toAnswers,
  type AnswerDrafts,
  type NoteDrafts,
} from "@/components/app/wizard/selection";

/** The Edit project list of types: the agency journey is not switched here. */
const EDITABLE_TYPE_OPTIONS = BUSINESS_TYPE_OPTIONS.filter((option) => option.value !== "agency");

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "Try again.";
}

function Legend({ id, children }: { id: string; children: string }) {
  return (
    <h3 id={id} className="font-mono text-small font-semibold">
      {children}
    </h3>
  );
}

/**
 * "Your answers" in Edit project: the first-run questions again (kind of
 * business, goals, where the owner is active, customers, own words), saved
 * as one set through `projects.saveFirstRunAnswers`. An agency project shows
 * its type read-only: the agency journey is its own organization model.
 */
export function FirstRunAnswersForm({ project }: { project: Doc<"projects"> }) {
  const save = useMutation(api.projects.saveFirstRunAnswers);
  const agency = project.businessType === "agency";
  const [drafts, setDrafts] = useState<AnswerDrafts>(() => fromStored(project));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const edit = (patch: Partial<AnswerDrafts>) => {
    setDrafts((current) => ({ ...current, ...patch }));
    setState("idle");
  };
  const setNote = (key: keyof NoteDrafts) => (value: string) =>
    edit({ notes: { ...drafts.notes, [key]: value } });

  const submit = async () => {
    setState("saving");
    setError("");
    try {
      // An agency project keeps its mark on the server; its type is not sent
      // (toAnswers leaves it out for an agency without a client type).
      const answers = toAnswers(drafts);
      const businessType = answers.businessType === "agency" ? undefined : answers.businessType;
      const saved = await save({ id: project._id, ...answers, businessType });
      setDrafts(fromStored(saved));
      setState("saved");
      toast.success("Answers saved");
    } catch (caught) {
      setError(errorText(caught));
      setState("error");
    }
  };

  return (
    <section aria-labelledby="answers-title" className="grid gap-5 rounded-lg border p-4">
      <div>
        <h2 id="answers-title" className="font-mono text-h2">Your answers</h2>
        <p className="mt-1 font-mono text-caption text-muted-foreground">
          What you told us when you set up the project. The first pick in each list is the main one.
        </p>
      </div>

      {agency ? (
        <div className="grid gap-1">
          <h3 className="font-mono text-small font-semibold">Kind of business</h3>
          <p className="font-mono text-caption text-muted-foreground">
            {businessTypeLabel("agency")}. This can’t be changed here.
          </p>
        </div>
      ) : (
        <MultiChoiceTiles<BusinessType>
          options={EDITABLE_TYPE_OPTIONS}
          value={drafts.types}
          onChange={(types) => edit({ types })}
          legend={<Legend id="answers-type">Kind of business</Legend>}
        >
          <OtherNote value={drafts.notes.businessType} onChange={setNote("businessType")} />
        </MultiChoiceTiles>
      )}

      <MultiChoiceTiles<PrimaryGoal>
        options={GOAL_OPTIONS}
        value={drafts.goals}
        onChange={(goals) => edit({ goals })}
        legend={<Legend id="answers-goals">What you want more of</Legend>}
      >
        <OtherNote value={drafts.notes.goal} onChange={setNote("goal")} />
      </MultiChoiceTiles>

      <MultiChoiceTiles<PostingChannel>
        options={CHANNEL_OPTIONS}
        value={drafts.channels}
        onChange={(channels) => edit({ channels })}
        exclusive={EXCLUSIVE_CHANNELS}
        legend={<Legend id="answers-channels">Where you are already active</Legend>}
      >
        <OtherNote value={drafts.notes.channel} onChange={setNote("channel")} />
      </MultiChoiceTiles>

      <MultiChoiceTiles<CustomerGroup>
        options={CUSTOMER_OPTIONS}
        value={drafts.customers}
        onChange={(customers) => edit({ customers })}
        legend={<Legend id="answers-customers">Who your customers are</Legend>}
      >
        <OtherNote value={drafts.notes.customers} onChange={setNote("customers")} />
      </MultiChoiceTiles>

      <AnythingElseNote value={drafts.notes.anythingElse} onChange={setNote("anythingElse")} />

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button onClick={() => void submit()} disabled={state === "saving"} className="min-h-11">
          {state === "saving" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Save answers
        </Button>
        <p role="status" aria-live="polite" className="font-mono text-caption text-muted-foreground">
          {state === "saving" ? "Saving your answers…" : state === "saved" ? "Saved." : ""}
        </p>
      </div>
      {state === "error" && (
        <p role="alert" className="font-mono text-caption text-destructive">
          Couldn’t save your answers. {error}
        </p>
      )}
    </section>
  );
}
