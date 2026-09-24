import { describe, expect, it } from "vitest";
import {
  DENIED_BY_DEFAULT_CONSENT,
  isValidEventId,
  isValidEventTime,
  normalizeConsentSnapshot,
} from "@/shared/contracts/measurement";

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
});
