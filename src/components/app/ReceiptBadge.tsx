/* ── ReceiptBadge (BP-03) ─────────────────────────────────────────────────
 *
 * The one badge for externally verifiable states. Green ("verified") is
 * shown only when server code holds a provider receipt or verification
 * record — never from a client claim. Anything else renders an honest,
 * non-green state. Keep the export maps in sync with
 * src/shared/contracts/status.ts (tests/unit/publish-truth.test.ts pins
 * their semantics).
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ReceiptState =
  | "verified"
  | "requires_verification"
  | "local"
  | "failed"
  | "needs_setup";

const TONE: Record<ReceiptState, string> = {
  verified:
    "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
  requires_verification:
    "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800",
  local: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700",
  failed:
    "bg-red-100 text-red-800 border-red-300 dark:bg-red-950 dark:text-red-300 dark:border-red-800",
  needs_setup:
    "bg-slate-100 text-slate-500 border-slate-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700",
};

const DOT: Record<ReceiptState, string> = {
  verified: "bg-emerald-500",
  requires_verification: "bg-amber-500",
  local: "bg-slate-400",
  failed: "bg-red-500",
  needs_setup: "bg-slate-400",
};

export const receiptTone = (state: ReceiptState): string => TONE[state];
export const receiptDotClass = (state: ReceiptState): string => DOT[state];
export const ReceiptBadge_LABELS: Record<ReceiptState, string> = {
  verified: "Verified by provider",
  requires_verification: "Requires verification",
  local: "Tracked in MOSAI",
  failed: "Failed — last confirmed release intact",
  needs_setup: "Needs setup",
};

export function ReceiptBadge({
  state,
  href,
  detail,
  className,
}: {
  state: ReceiptState;
  /** Real provider receipt / verification record URL. Required for verified. */
  href?: string | null;
  detail?: string;
  className?: string;
}) {
  if (state === "verified" && !href) {
    // Truth rule: a green badge without a receipt is a lie. Demote it.
    state = "requires_verification";
  }
  const label = ReceiptBadge_LABELS[state];
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", receiptDotClass(state))}
      />
      {label}
      {detail ? <span className="font-normal opacity-80">· {detail}</span> : null}
    </>
  );
  const base = cn(
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
    receiptTone(state),
    className,
  );
  if (state === "verified" && href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(base, "transition-opacity hover:opacity-80")}
        aria-label={`${label} — open provider receipt`}
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
