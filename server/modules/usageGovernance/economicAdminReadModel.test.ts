import { describe, expect, it } from "vitest";
import { economicAdminMonthRange, isEconomicAdminRowInMonth } from "./economicAdminReadModel";

describe("billing economic admin month window", () => {
  it("queries the requested month plus the two prior months needed for the rolling indicator", () => {
    const range = economicAdminMonthRange("2026-08");
    expect(range.historyFrom.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(range.from.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("keeps historical month selection independent from newer rows", () => {
    expect(isEconomicAdminRowInMonth("2024-03-01T00:00:00.000Z", "2024-03")).toBe(true);
    expect(isEconomicAdminRowInMonth("2026-08-01T00:00:00.000Z", "2024-03")).toBe(false);
  });
});
