import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Social queue executor: publish any due scheduled posts, every 2 minutes.
crons.interval(
  "publish-due-social-posts",
  { minutes: 2 },
  internal.social.executor.runDue,
  {},
);

export default crons;
