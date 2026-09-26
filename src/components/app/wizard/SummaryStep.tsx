import type { ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { defaultGoalFor } from "@/shared/starterKit";
import {
  businessTypeLabel,
  channelLabel,
  customerLabel,
  goalLabel,
} from "@/components/app/wizard/questionOptions";
import { answeredType, isAgency, type AnswerDrafts } from "@/components/app/wizard/selection";
import { hasFoundDetails } from "@/components/app/wizard/findings";
import type { FoundDetails, SourceFindingsStatus } from "@/components/app/wizard/types";

/** Where each "Fix" goes: the index of the wizard screen. */
export const SUMMARY_FIX_STEPS = { type: 0, name: 1, goals: 2, channels: 3, customers: 4 } as const;

function Part({
  id,
  title,
  fixLabel,
  onFix,
  children,
}: {
  id: string;
  title: string;
  fixLabel: string;
  onFix: () => void;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-2 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <h2 id={id} className="font-mono text-small font-semibold">{title}</h2>
        <Button type="button" variant="link" className="min-h-11 min-w-11 px-2 font-mono text-caption" onClick={onFix}>
          Fix<span className="sr-only"> {fixLabel}</span>
        </Button>
      </div>
      <div className="grid gap-1 font-mono text-caption text-muted-foreground">{children}</div>
    </section>
  );
}

function OrderedAnswers<T extends string>({ items, labelOf }: { items: readonly T[]; labelOf: (item: T) => string }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <li key={item} className="flex items-center gap-2 text-foreground">
          {labelOf(item)}
          {index === 0 && items.length > 1 && (
            <Badge variant="outline" className="border-terminal-green/40 font-mono text-caption text-terminal-green-ink">
              Main
            </Badge>
          )}
          {index < items.length - 1 && <span aria-hidden="true">·</span>}
        </li>
      ))}
    </ul>
  );
}

function OwnWords({ label, value }: { label: string; value: string }) {
  const cleaned = value.trim();
  if (!cleaned) return null;
  return (
    <p>
      {label}: <span className="text-foreground">{cleaned}</span>
    </p>
  );
}

const DETAIL_ROWS: Array<{ key: keyof FoundDetails; label: string }> = [
  { key: "name", label: "Name" },
  { key: "category", label: "Category" },
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "website", label: "Website" },
  { key: "openHours", label: "Opening hours" },
  { key: "productsServices", label: "Products and services" },
  { key: "socialChannels", label: "Social profiles" },
];

function detailText(details: FoundDetails, key: keyof FoundDetails): string | undefined {
  const value = details[key];
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "string") return value;
  return undefined;
}

function Findings({ findings }: { findings: SourceFindingsStatus }) {
  if (findings.status === "none") {
    return <p>You didn’t add a website or Google listing. That’s fine, the kit will use your answers.</p>;
  }
  const what = findings.kind === "website" ? "your site" : "your Google listing";
  if (findings.status === "running") {
    return (
      <p className="flex items-center gap-2">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        We’re still reading {what}. Making the kit waits for it to finish.
      </p>
    );
  }
  if (findings.failed || !hasFoundDetails(findings.details)) {
    return (
      <p className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {findings.failed
          ? `We couldn’t read ${what}; that’s fine, the kit will use your answers.`
          : `We read ${what} but found no contact details; that’s fine, the kit will use your answers.`}
      </p>
    );
  }
  const { details } = findings;
  return (
    <>
      <dl className="grid gap-1">
        {DETAIL_ROWS.map(({ key, label }) => {
          const value = detailText(details, key);
          if (!value) return null;
          return (
            <div key={key} className="grid gap-0.5 sm:grid-cols-3 sm:gap-3">
              <dt>{label}</dt>
              <dd className="min-w-0 break-words text-foreground sm:col-span-2">{value}</dd>
            </div>
          );
        })}
        {typeof details.rating === "number" && (
          <div className="grid gap-0.5 sm:grid-cols-3 sm:gap-3">
            <dt>Google rating</dt>
            <dd className="text-foreground sm:col-span-2">
              {details.rating}
              {typeof details.reviews === "number" ? ` from ${details.reviews} reviews` : ""}
            </dd>
          </div>
        )}
      </dl>
      {findings.partial && <p>We could only read part of {what}. The kit uses what we found.</p>}
    </>
  );
}

/**
 * The last screen, "Here's what we found": what the scan or listing actually
 * returned plus the owner's answers, each with a "Fix" back to its screen.
 */
export function SummaryStep({
  name,
  sourceText,
  findings,
  answers,
  onFix,
}: {
  name: string;
  /** What the owner typed in the Q2 source field, as they will recognise it. */
  sourceText?: string;
  findings: SourceFindingsStatus;
  answers: AnswerDrafts;
  onFix: (step: number) => void;
}) {
  const agency = isAgency(answers.types);
  const fallbackGoal = defaultGoalFor(answeredType(answers));
  return (
    <section className="grid gap-5 rounded-lg border bg-card p-4 shadow-card sm:p-7" aria-labelledby="q-summary-title">
      <div>
        <h1 id="q-summary-title" className="font-mono text-h1">Here’s what we found</h1>
        <p className="mt-2 font-mono text-caption text-muted-foreground">
          Check it over. Fix anything that looks wrong, then make your starter kit.
        </p>
      </div>
      <div className="grid gap-4">
        <Part id="sum-found" title="From your website or listing" fixLabel="website or listing" onFix={() => onFix(SUMMARY_FIX_STEPS.name)}>
          <div role="status" aria-live="polite" className="grid gap-1">
            <Findings findings={findings} />
          </div>
        </Part>
        <Part id="sum-name" title={agency ? "Your client’s business" : "Name"} fixLabel="name" onFix={() => onFix(SUMMARY_FIX_STEPS.name)}>
          <p className="text-foreground">{name.trim()}</p>
          {sourceText && <p>Read from: <span className="text-foreground">{sourceText}</span></p>}
        </Part>
        <Part id="sum-type" title="Kind of business" fixLabel="kind of business" onFix={() => onFix(SUMMARY_FIX_STEPS.type)}>
          {agency ? (
            <>
              <p className="text-foreground">{businessTypeLabel("agency")}</p>
              <p>
                Client: <span className="text-foreground">{answers.clientType ? businessTypeLabel(answers.clientType) : "Not picked"}</span>
              </p>
            </>
          ) : answers.types.length ? (
            <OrderedAnswers items={answers.types} labelOf={businessTypeLabel} />
          ) : (
            <p>Not picked.</p>
          )}
          {!agency && <OwnWords label="Other" value={answers.notes.businessType} />}
        </Part>
        <Part id="sum-goals" title="What you want more of" fixLabel="what you want more of" onFix={() => onFix(SUMMARY_FIX_STEPS.goals)}>
          {answers.goals.length ? (
            <OrderedAnswers items={answers.goals} labelOf={goalLabel} />
          ) : (
            <p>{fallbackGoal ? `Skipped. We’ll start with “${goalLabel(fallbackGoal)}”.` : "Skipped."}</p>
          )}
          <OwnWords label="Other" value={answers.notes.goal} />
        </Part>
        <Part id="sum-channels" title="Where you’re active" fixLabel="where you’re active" onFix={() => onFix(SUMMARY_FIX_STEPS.channels)}>
          {answers.channels.length ? <OrderedAnswers items={answers.channels} labelOf={channelLabel} /> : <p>Skipped.</p>}
          <OwnWords label="Other" value={answers.notes.channel} />
        </Part>
        <Part id="sum-customers" title="Your customers" fixLabel="your customers" onFix={() => onFix(SUMMARY_FIX_STEPS.customers)}>
          {answers.customers.length ? <OrderedAnswers items={answers.customers} labelOf={customerLabel} /> : <p>Skipped.</p>}
          <OwnWords label="Other" value={answers.notes.customers} />
          <OwnWords label="Anything else" value={answers.notes.anythingElse} />
        </Part>
      </div>
    </section>
  );
}
