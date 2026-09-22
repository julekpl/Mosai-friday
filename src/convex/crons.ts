import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

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

export default crons;
