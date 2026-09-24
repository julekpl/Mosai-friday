import { describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import {
  DENIED_BY_DEFAULT_CONSENT,
  isValidEventId,
  isValidEventTime,
  normalizeConsentSnapshot,
} from "@/shared/contracts/measurement";
import { newBackend, seedUser } from "./helpers";

const EVENT_ID = "550e8400-e29b-41d4-a716-446655440000";

describe("BP-12/S1 measurement contract", () => {
  it("represents missing consent as denied and validates safe event identifiers and times", () => {
    expect(DENIED_BY_DEFAULT_CONSENT).toEqual({
      analytics: false,
      advertising: false,
    });
    expect(normalizeConsentSnapshot(undefined)).toEqual(
      DENIED_BY_DEFAULT_CONSENT,
    );
    expect(normalizeConsentSnapshot({ analytics: true })).toEqual({
      analytics: true,
      advertising: false,
    });
    expect(isValidEventId(EVENT_ID)).toBe(true);
    expect(isValidEventId("client-event-1")).toBe(false);
    expect(isValidEventTime(Date.now())).toBe(true);
    expect(isValidEventTime(Date.now() + 10 * 60_000)).toBe(false);
  });

  it("keeps collection unavailable even when a browser claims consent", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Owner project",
    });

    await expect(
      owner.as.mutation(api.commerceEvents.collect, { projectId }),
    ).resolves.toEqual({ status: "unavailable" });

    await expect(
      owner.as.mutation(api.commerceEvents.collect, {
        projectId,
        eventId: EVENT_ID,
        type: "page_view",
        occurredAt: Date.now(),
        consent: { analytics: true, advertising: true },
      } as never),
    ).rejects.toThrow();

    expect(
      await t.run((ctx) => ctx.db.query("commerceEvents").collect()),
    ).toEqual([]);
  });

  it("authorizes the project even while collection is disabled", async () => {
    const t = newBackend();
    const owner = await seedUser(t, { plan: "scale" });
    const other = await seedUser(t, { plan: "scale" });
    const projectId = await owner.as.mutation(api.projects.create, {
      name: "Owner project",
    });

    await expect(
      other.as.mutation(api.commerceEvents.collect, { projectId }),
    ).rejects.toThrow("Not found");
    expect(
      await t.run((ctx) => ctx.db.query("commerceEvents").collect()),
    ).toEqual([]);
  });
});
