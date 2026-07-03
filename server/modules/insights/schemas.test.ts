import { describe, expect, it } from "vitest";
import { patientPeriodBundleSchema } from "../professionals/schemas";
import {
  MAX_REPORT_RANGE_DAYS,
  reportsHabitAnalyticsSchema,
  reportsPeriodSchema,
} from "./schemas";

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

  it("rejeita datas malformadas", () => {
    const result = reportsHabitAnalyticsSchema.safeParse({
      startDate: "01/01/2026",
      endDate: "2026-01-31",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map(issue => issue.message)).toContain("Use datas no formato YYYY-MM-DD.");
  });

  it("rejeita datas ausentes", () => {
    const result = reportsHabitAnalyticsSchema.safeParse({
      startDate: "2026-01-01",
    });

    expect(result.success).toBe(false);
  });

  it("aceita deslocamento semanal histórico dentro do limite", () => {
    expect(reportsPeriodSchema.safeParse({ weekOffset: -120 }).success).toBe(true);
    expect(reportsPeriodSchema.safeParse({ weekOffset: 120 }).success).toBe(true);
  });

  it("rejeita deslocamento semanal fora do limite", () => {
    expect(reportsPeriodSchema.safeParse({ weekOffset: -521 }).success).toBe(false);
    expect(reportsPeriodSchema.safeParse({ weekOffset: 521 }).success).toBe(false);
  });

  it("reutiliza o limite de período no bundle profissional", () => {
    const result = patientPeriodBundleSchema.safeParse({
      patientId: 1,
      startDate: "2026-01-01",
      endDate: "2026-04-01",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Escolha um período de até 90 dias.");
  });
});
