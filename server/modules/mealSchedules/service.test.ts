import { describe, expect, it } from "vitest";
import { suggestMealLabelForTime, updateMealSchedules } from "./service";

describe("meal schedules", () => {
  it("suggests lunch inside the default lunch range", async () => {
    const result = await suggestMealLabelForTime(9101, {
      occurredAt: "2026-05-20T14:30:00.000Z",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.mealLabel).toBe("almoço");
    expect(result.confidence).toBe(1);
  });

  it("supports ranges that cross midnight", async () => {
    const result = await suggestMealLabelForTime(9102, {
      occurredAt: "2026-05-20T05:30:00.000Z",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.mealLabel).toBe("outro");
    expect(result.confidence).toBe(1);
  });

  it("uses custom user schedules", async () => {
    await updateMealSchedules(9103, {
      schedules: [
        { mealLabel: "café da manhã", startTime: "06:00", endTime: "08:59", enabled: true },
        { mealLabel: "lanche", startTime: "09:00", endTime: "10:00", enabled: true },
        { mealLabel: "almoço", startTime: "10:01", endTime: "15:00", enabled: true },
      ],
    });

    const result = await suggestMealLabelForTime(9103, {
      occurredAt: "2026-05-20T12:30:00.000Z",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.mealLabel).toBe("lanche");
  });
});
