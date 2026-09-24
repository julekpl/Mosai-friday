import { describe, expect, it } from "vitest";
import { summarizeProjectScan } from "@/lib/project-scan-status";

describe("project onboarding source status", () => {
  it("reports partial when one requested source succeeds and the other fails", () => {
    expect(
      summarizeProjectScan({ website: "succeeded", business: "failed" }),
    ).toBe("partial");
    expect(
      summarizeProjectScan({ website: "failed", business: "succeeded" }),
    ).toBe("partial");
  });

  it("reports complete only when every requested source succeeds", () => {
    expect(
      summarizeProjectScan({ website: "succeeded", business: "succeeded" }),
    ).toBe("scraped");
    expect(
      summarizeProjectScan({ website: "succeeded", business: "not_requested" }),
    ).toBe("scraped");
  });

  it("keeps no-source and all-failed outcomes distinct", () => {
    expect(
      summarizeProjectScan({
        website: "not_requested",
        business: "not_requested",
      }),
    ).toBe("idle");
    expect(
      summarizeProjectScan({ website: "failed", business: "failed" }),
    ).toBe("failed");
  });

  it("does not call an unconfirmed search result a completed scan", () => {
    expect(
      summarizeProjectScan({
        website: "not_requested",
        business: "needs_review",
      }),
    ).toBe("partial");
    expect(
      summarizeProjectScan({ website: "succeeded", business: "needs_review" }),
    ).toBe("partial");
    expect(
      summarizeProjectScan({ website: "succeeded", business: "skipped" }),
    ).toBe("partial");
  });
});
