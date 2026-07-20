import { describe, expect, it, vi } from "vitest";
import {
  assertProfessionalAiOutputIsSafe,
  isClinicalRequest,
} from "./aiSafety";
import { createProfessionalAiService } from "./aiService";

function assistantOutput(summary: string) {
  return {
    title: "Resumo do período",
    summary,
    summarySourceKeys: ["current_period"],
    facts: [],
    factSourceKeys: [],
    interpretations: [],
    interpretationSourceKeys: [],
    missingData: [],
    cautions: [],
    draft: null,
    educationalNotice: "Aviso educativo.",
  } as any;
}

function periodBundle(range: { startDate: string; endDate: string }) {
  return {
    range: { ...range, dayCount: 7 },
    totals: { calories: 9_800, protein: 630, carbs: 1_100, fat: 350 },
    daily: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-07-${String(index + 8).padStart(2, "0")}`,
      calories: 1_400,
      adjustedGoalCalories: 1_500,
    })),
    habitAnalytics: {
      water: {
        totalConsumedMl: 12_000,
        totalGoalMl: 14_000,
        goalHitDays: 5,
        averageDailyMl: 1_714,
      },
      exercise: {
        totalCalories: 1_200,
        totalDurationMinutes: 240,
        activeDays: 4,
      },
    },
    quality: {
      foodQuality: {
        hasData: true,
        daysWithRecords: 7,
        qualityIndex: 72,
        ultraProcessedCaloriesPercent: 18,
        naturalOrMinimallyProcessedCaloriesPercent: 62,
      },
    },
    weightTrend: {
      summary: {
        hasData: true,
        firstWeightKg: 70,
        lastWeightKg: 69.5,
        deltaKg: -0.5,
      },
    },
    analytics: {
      adherence: {
        adherencePercent: 93.3,
        daysWithinRange: 6,
        daysAboveRange: 0,
        daysBelowRange: 1,
        daysWithoutRecords: 0,
      },
      plannedMacros: { protein: 700, carbs: 1_200, fat: 420 },
      recordFrequency: {
        daysWithRecords: 7,
        daysWithoutRecords: 0,
        totalDays: 7,
      },
    },
  } as any;
}

function providerResponse() {
  return {
    id: "response-1",
    created: Date.now(),
    model: "test-model",
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: {
          role: "assistant" as const,
          content: JSON.stringify({
            title: "Comparação de períodos",
            summary: "Comparação objetiva dos períodos.",
            summarySourceKeys: ["current_period", "previous_period"],
            facts: [],
            factSourceKeys: [],
            interpretations: [
              "O período anterior possuía uma pesagem pendente.",
            ],
            interpretationSourceKeys: [["previous_alerts"]],
            missingData: [],
            cautions: [],
            draft: null,
            educationalNotice: "Aviso educativo.",
          }),
        },
      },
    ],
  };
}

describe("professional AI adversarial regressions", () => {
  it.each([
    "O paciente apresenta hipertensão.",
    "O quadro é compatível com doença renal.",
    "Reduza a meta para 800 kcal.",
    "Elimine carboidratos por duas semanas.",
    "Inicie jejum prolongado diariamente.",
    "Ajuste a medicação anti-hipertensiva.",
  ])("rejects unsupported clinical or autonomous output: %s", text => {
    expect(() => assertProfessionalAiOutputIsSafe(assistantOutput(text))).toThrow(
      "professional_ai_prohibited_clinical_output"
    );
  });

  it("keeps objective, non-prescriptive summaries valid", () => {
    expect(() =>
      assertProfessionalAiOutputIsSafe(
        assistantOutput("A aderência calórica foi de 93,3% no período.")
      )
    ).not.toThrow();
  });

  it.each([
    "O paciente está com hipertensão?",
    "Reduza a meta para 800 kcal.",
    "Elimine carboidratos por duas semanas.",
    "Inicie jejum prolongado diariamente.",
  ])("blocks clinical or autonomous requests before the provider: %s", question => {
    expect(isClinicalRequest(question)).toBe(true);
  });

  it("loads real alerts for current and previous periods before exposing sources", async () => {
    const currentRange = {
      startDate: "2026-07-08",
      endDate: "2026-07-14",
    };
    const previousRange = {
      startDate: "2026-07-01",
      endDate: "2026-07-07",
    };
    const getPeriodBundle = vi.fn(
      async (
        _professionalUserId: number,
        _patientUserId: number,
        range: { startDate: string; endDate: string }
      ) => periodBundle(range)
    );
    const listAlerts = vi.fn(
      async (
        _professionalUserId: number,
        _patientUserId?: number,
        range?: { startDate: string; endDate: string }
      ) =>
        range?.startDate === previousRange.startDate
          ? [
              {
                patientUserId: 41,
                patientName: "Ana",
                type: "weigh_in_overdue",
                severity: "attention",
                suggestedAction: "Solicitar pesagem",
                updatedAt: 100,
                period: { start: 1, end: 2 },
              },
            ]
          : []
    );
    const service = createProfessionalAiService({
      getTimeZone: vi.fn().mockResolvedValue({
        timeZone: "America/Sao_Paulo",
        source: "profile",
      }),
      getPeriodBundle: getPeriodBundle as any,
      listAlerts: listAlerts as any,
      appendHistory: vi.fn().mockResolvedValue({}),
      logEvent: vi.fn(),
      now: () => new Date("2026-07-20T12:00:00.000Z"),
      providerTimeoutMs: 100,
      invoke: vi.fn().mockResolvedValue(providerResponse()),
    });

    const result = await service.generate(1, {
      patientId: 41,
      ...currentRange,
      mode: "comparison",
    });

    expect(listAlerts).toHaveBeenNthCalledWith(1, 1, 41, currentRange);
    expect(listAlerts).toHaveBeenNthCalledWith(2, 1, 41, previousRange);
    expect(
      result.sourceSignals.find(signal => signal.key === "current_alerts")?.value
    ).toBe("Nenhum alerta objetivo aberto no período");
    expect(
      result.sourceSignals.find(signal => signal.key === "previous_alerts")?.value
    ).toContain("Pesagem pendente (attention)");
    expect(result.interpretationSourceKeys).toEqual([["previous_alerts"]]);
    expect(result.fallbackUsed).toBe(false);
  });
});
