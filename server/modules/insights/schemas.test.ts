import { describe, expect, it } from "vitest";
import { reportsHabitAnalyticsSchema, reportsPeriodSchema } from "./schemas";
import { patientPeriodBundleSchema } from "../professionals/schemas";

describe("bounded report range schemas", () => {
  it("aceita período inclusivo de até 90 dias", () => {
    expect(() => reportsHabitAnalyticsSchema.parse({
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    })).not.toThrow();
  });

  it("rejeita período acima de 90 dias inclusivos", () => {
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

  it("aceita navegação semanal além da semana anterior", () => {
    expect(reportsPeriodSchema.parse({ weekOffset: -8 })).toEqual({ weekOffset: -8 });
    expect(reportsPeriodSchema.parse({ weekOffset: 4 })).toEqual({ weekOffset: 4 });
  });

  it("bloqueia navegação semanal excessiva", () => {
    expect(reportsPeriodSchema.safeParse({ weekOffset: -53 }).success).toBe(false);
    expect(reportsPeriodSchema.safeParse({ weekOffset: 53 }).success).toBe(false);
  });

  it("aplica o mesmo limite no bundle profissional por paciente", () => {
    const result = patientPeriodBundleSchema.safeParse({
      patientId: 123,
      startDate: "2026-01-01",
      endDate: "2026-04-01",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["endDate"]);
  });
});
