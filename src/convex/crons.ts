import { anyApi, cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
const privacyInternal = anyApi.modules.privacy;

// Social queue executor: publish any due scheduled posts, every 2 minutes.
crons.interval(
  "publish-due-social-posts",
  { minutes: 5 },
  internal.social.executor.runDue,
  {},
);

// Billing reconciliation (T2.4): compare the local mirror with Stripe and
// record a run. Target is 0 drift; the run timestamped daily is the audit
// trail the admin panel reads.
crons.daily(
  "billing-reconciliation",
  { hourUTC: 4, minuteUTC: 0 },
  internal.billing.reconcileNow,
  { source: "cron" },
);

// Wind-down sweep (T2.4): a subscription past the dunning grace period moves
// to the honest `wind_down` state. Nothing is deleted.
crons.interval(
  "billing-wind-down-sweep",
  { hours: 6 },
  internal.billingWebhooks.windDownSweep,
  {},
);

// Account/project deletion is explicit and resumable. Each mutation advances
// one bounded item; this interval recovers a scheduled step after failures.
crons.interval(
  "privacy-account-deletion-finalizer",
  { minutes: 5 },
  privacyInternal.deletionJobs.finalizeDue,
  {},
);

// Export work and expiry are separate bounded jobs. Export chunks are
// downloadable for seven days after generation and then removed.
crons.interval(
  "privacy-account-export-worker",
  { minutes: 15 },
  privacyInternal.exportJobs.processBatch,
  {},
);
crons.daily(
  "privacy-export-expiry",
  { hourUTC: 3, minuteUTC: 30 },
  privacyInternal.exportJobs.expireCompletedExports,
  {},
);

// Bounded cleanup of OTP SMTP acceptance receipts after their 30-day window.
crons.interval(
  "otp-email-receipt-expiry",
  { minutes: 5 },
  internal.auth.otpDelivery.sweepExpired,
  {},
);

// Grow: daily Google (GA4, Search Console, Google Ads) sync. Queues one job
// per connected project; the jobs are staggered and record their outcome.
crons.daily(
  "google-daily-sync",
  { hourUTC: 5, minuteUTC: 17 },
  internal.google.sync.enqueueDailyRuns,
  {},
);

// U5: expired Pexels search cache rows (24 h TTL) are swept daily in
// bounded batches; a full batch schedules the next one.
crons.daily(
  "stock-search-cache-sweep",
  { hourUTC: 3, minuteUTC: 47 },
  internal.stockStore.sweepStockCache,
  {},
);

export default crons;
