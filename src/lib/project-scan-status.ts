export type ProjectScanSourceStatus =
  | "not_requested"
  | "succeeded"
  | "partial"
  | "failed"
  | "needs_review"
  | "skipped";

export type ProjectScanSummary = "idle" | "scraped" | "partial" | "failed";

export function summarizeProjectScan(sources: {
  website: ProjectScanSourceStatus;
  business: ProjectScanSourceStatus;
}): ProjectScanSummary {
  const requested = [sources.website, sources.business].filter(
    (status) => status !== "not_requested",
  );
  if (requested.length === 0) return "idle";
  if (requested.includes("needs_review") || requested.includes("partial")) return "partial";
  const succeeded = requested.filter((status) => status === "succeeded").length;
  if (succeeded === 0) return "failed";
  return succeeded === requested.length ? "scraped" : "partial";
}
