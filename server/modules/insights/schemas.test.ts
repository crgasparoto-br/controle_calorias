import { describe, expect, it } from "vitest";
import { MAX_REPORT_RANGE_DAYS, reportsHabitAnalyticsSchema } from "./schemas";

describe("reports period schema", () => {
  it("aceita períodos de até 90 dias inclusivos", () => {
    const result = reportsHabitAnalyticsSchema.safeParse({
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    });

    expect(MAX_REPORT_RANGE_DAYS).toBe(90);
    expect(result.success).toBe(true);
  });

  it("rejeita períodos acima de 90 dias inclusivos", () => {
    const result = reportsHabitAnalyticsSchema.safeParse({
      startDate: "2026-01-01",
      endDate: "2026-04-01",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Escolha um período de até 90 dias.");
  });

  it("rejeita período invertido", () => {
    const result = reportsHabitAnalyticsSchema.safeParse({
      startDate: "2026-04-01",
      endDate: "2026-01-01",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("A data final deve ser igual ou posterior à data inicial.");
  });
});
