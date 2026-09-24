/* ── ReceiptBadge (BP-03) ─────────────────────────────────────────────────
 *
 * The one badge for externally verifiable states. The "verified" tone is
 * shown only when server code holds a provider receipt or verification
 * record for the exact revision — never from a client claim. Everything
 * else renders an honest, non-green state.
 *
 * Classification (label → tone) has a single source:
 * src/shared/contracts/status.ts. Keep that file authoritative; this
 * component only renders. tests/unit/publish-truth.test.ts pins the
 * semantics of both.
 */
import { receiptTone, type ReceiptTone } from "@/shared/contracts/status";
import { cn } from "@/lib/utils";

export { receiptTone };
export type { ReceiptTone };

/* Dot colour per tone — token classes only (src/index.css terminal palette).
 * Only the verified tone is green; unverified is amber; locked is neutral. */
export const receiptDotClass: Record<ReceiptTone, string> = {
  verified: "bg-terminal-green",
  prepared: "bg-terminal-blue",
  unverified: "bg-terminal-amber",
  locked: "bg-muted-foreground/50",
};

/* Badge chrome per tone. */
const TONE_CLASS: Record<ReceiptTone, string> = {
  verified:
    "border-terminal-green/40 bg-terminal-green-soft text-terminal-green",
  prepared:
    "border-terminal-blue/40 bg-terminal-blue-soft text-terminal-blue",
  unverified:
    "border-terminal-amber/40 bg-terminal-amber-soft text-terminal-amber",
  locked: "border-border bg-muted text-muted-foreground",
};

/* Honest human text per delivery label. An unverified label must never be
 * titled like a success — tests pin this. */
export const ReceiptBadge_LABELS: Record<string, string> = {
  verified: "Verified by provider",
  release_prepared: "Release prepared — not yet live",
  deploying: "Deploying…",
  draft_approved: "Draft approved",
  content_changed: "Content changed — re-prepare the release",
  requires_verification: "Requires verification",
  deployment_missing: "Not deployed",
  unavailable: "Unavailable",
  // legacy values are readable but never verified by classification alone
  published: "Requires verification (legacy)",
  live: "Requires verification (legacy)",
  sent: "Requires verification (legacy)",
  paid: "Requires verification (legacy)",
  running: "Tracked in MOSAI (local)",
};

export function ReceiptBadge({
  label,
  href,
  detail,
  className,
}: {
  /** Delivery label (src/shared/contracts/status.ts vocabulary). */
  label: string;
  /** Real provider receipt / verification record URL. Required for verified. */
  href?: string | null;
  /** Safe, redacted detail line (never a provider body). */
  detail?: string;
  className?: string;
}) {
  let tone = receiptTone(label);
  // Truth rule: a green badge without a receipt is a lie. Demote it.
  if (tone === "verified" && !href) {
    tone = "unverified";
    label = "requires_verification";
  }
  const text = ReceiptBadge_LABELS[label] ?? label;
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full", receiptDotClass[tone])}
      />
      {text}
      {detail ? (
        <span className="font-normal opacity-80">· {detail}</span>
      ) : null}
    </>
  );
  const base = cn(
    "inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-caption font-medium",
    TONE_CLASS[tone],
    className,
  );
  // A successful external badge opens its real provider receipt.
  if (tone === "verified" && href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          base,
          "underline-offset-2 transition-[box-shadow,text-decoration-color] duration-150 ease-terminal hover:underline hover:shadow-card focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
        aria-label={`${text} — open provider receipt`}
      >
        {content}
      </a>
    );
  }
  return (
    <span className={base} title={detail}>
      {content}
    </span>
  );
}
