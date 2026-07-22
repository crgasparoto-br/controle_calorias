import { describe, expect, it } from "vitest";
import {
  buildOperationalAlertDedupeKey,
  getDateKeyInZone,
  getNoFoodRecordsWindow,
  isOperationalAlertScopeActive,
  shouldCloseWeighInRequest,
  startOfCalendarDayInZone,
} from "./operationalAlertRules";

describe("professional operational alert rules", () => {
  it("uses three patient-local calendar dates instead of the server timezone", () => {
    const now = new Date("2026-07-20T02:30:00.000Z");
    const saoPaulo = getNoFoodRecordsWindow(now, "America/Sao_Paulo");
    const tokyo = getNoFoodRecordsWindow(now, "Asia/Tokyo");

    expect(saoPaulo.startDateKey).toBe("2026-07-17");
    expect(saoPaulo.endDateKey).toBe("2026-07-19");
    expect(tokyo.startDateKey).toBe("2026-07-18");
    expect(tokyo.endDateKey).toBe("2026-07-20");
    expect(getDateKeyInZone(saoPaulo.start, "America/Sao_Paulo")).toBe(
      "2026-07-17"
    );
    expect(getDateKeyInZone(tokyo.start, "Asia/Tokyo")).toBe("2026-07-18");
    expect(saoPaulo.end).toEqual(now);
    expect(tokyo.end).toEqual(now);
  });

  it("supports timezone offsets with minutes", () => {
    const start = startOfCalendarDayInZone(
      new Date("2026-07-20T18:00:00.000Z"),
      "Asia/Kathmandu"
    );
    expect(start.toISOString()).toBe("2026-07-19T18:15:00.000Z");
  });

  it("keeps a stable idempotency key for the same origin", () => {
    const first = buildOperationalAlertDedupeKey(
      "authorization-1",
      "weigh_in_overdue",
      "request-1"
    );
    const concurrentEvaluation = buildOperationalAlertDedupeKey(
      "authorization-1",
      "weigh_in_overdue",
      "request-1"
    );

    expect(first).toBe("authorization-1:weigh_in_overdue:request-1");
    expect(concurrentEvaluation).toBe(first);
  });

  it("isolates equivalent origins between different authorizations", () => {
    expect(
      buildOperationalAlertDedupeKey(
        "authorization-1",
        "record_requires_review",
        "record-1"
      )
    ).not.toBe(
      buildOperationalAlertDedupeKey(
        "authorization-2",
        "record_requires_review",
        "record-1"
      )
    );
  });

  it("closes a weigh-in request only for weight measured after the request", () => {
    const requestCreatedAt = new Date("2026-07-10T12:00:00.000Z");

    expect(
      shouldCloseWeighInRequest(
        requestCreatedAt,
        new Date("2026-07-10T12:00:00.000Z")
      )
    ).toBe(true);
    expect(
      shouldCloseWeighInRequest(
        requestCreatedAt,
        new Date("2026-07-10T11:59:59.999Z")
      )
    ).toBe(false);
    expect(shouldCloseWeighInRequest(requestCreatedAt, null)).toBe(false);
  });

  it.each([
    ["approved", "active", true],
    ["revoked", "active", false],
    ["approved", "paused", false],
    ["approved", "closed", false],
    ["pending", "active", false],
  ])(
    "evaluates scope authorization=%s tracking=%s as active=%s",
    (authorizationStatus, trackingStatus, expected) => {
      expect(
        isOperationalAlertScopeActive(authorizationStatus, trackingStatus)
      ).toBe(expected);
    }
  );
});
