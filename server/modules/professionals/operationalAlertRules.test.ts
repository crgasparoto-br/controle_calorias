import { describe, expect, it } from "vitest";
import {
  buildOperationalAlertDedupeKey,
  getDateKeyInZone,
  getNoFoodRecordsWindow,
  startOfCalendarDayInZone,
} from "./operationalAlertRules";

describe("professional operational alert rules", () => {
  it("uses the patient's calendar day instead of the server timezone", () => {
    const now = new Date("2026-07-20T02:30:00.000Z");
    const saoPaulo = getNoFoodRecordsWindow(now, "America/Sao_Paulo");
    const tokyo = getNoFoodRecordsWindow(now, "Asia/Tokyo");

    expect(getDateKeyInZone(saoPaulo.start, "America/Sao_Paulo")).toBe(
      "2026-07-16"
    );
    expect(getDateKeyInZone(tokyo.start, "Asia/Tokyo")).toBe("2026-07-17");
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
    expect(
      buildOperationalAlertDedupeKey(
        "authorization-1",
        "weigh_in_overdue",
        "request-1"
      )
    ).toBe("authorization-1:weigh_in_overdue:request-1");
  });
});
