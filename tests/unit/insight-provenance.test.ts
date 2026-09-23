import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import { newBackend, seedUser } from "./helpers";

describe("Grow insight provenance", () => {
  it("accepts manual notes about provider data but rejects provider/internal source claims", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "P" });

    await owner.as.mutation(api.insights.create, {
      projectId,
      kind: "recommendation",
      title: "GA4 says organic sessions increased",
      source: "manual",
    });

    const saved = await owner.as.query(api.insights.list, { projectId });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      title: "GA4 says organic sessions increased",
      source: "manual",
    });
    expect(saved[0].freshness).toBeUndefined();

    for (const source of ["internal", "ga4", "gsc", "matomo", "posthog", "gtm", "fake-provider"]) {
      await expect(
        owner.as.mutation(api.insights.create, {
          projectId,
          kind: "recommendation",
          title: `Claim from ${source}`,
          source,
        }),
      ).rejects.toThrow();
    }

    expect(await owner.as.query(api.insights.list, { projectId })).toHaveLength(1);
  });

  it("keeps create and list scoped to the owning tenant", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale", email: "owner@example.com" });
    const other = await seedUser(t, { plan: "scale", email: "other@example.com" });
    const projectId = await owner.as.mutation(api.projects.create, { name: "Owner project" });
    const otherProjectId = await other.as.mutation(api.projects.create, { name: "Other project" });

    await owner.as.mutation(api.insights.create, {
      projectId,
      kind: "seo",
      title: "Owner note",
      source: "manual",
    });

    await expect(
      other.as.mutation(api.insights.create, {
        projectId,
        kind: "seo",
        title: "Cross-tenant note",
        source: "manual",
      }),
    ).rejects.toThrow();

    expect(await other.as.query(api.insights.list, { projectId })).toEqual([]);
    expect(await owner.as.query(api.insights.list, { projectId })).toHaveLength(1);
    expect(await other.as.query(api.insights.list, { projectId: otherProjectId })).toEqual([]);
  });
});
