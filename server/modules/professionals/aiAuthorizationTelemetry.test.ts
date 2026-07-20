import { describe, expect, it, vi } from "vitest";
import { createProfessionalAiPriorityAlertSource } from "./aiPrioritiesAccess";
import { createProfessionalAiService } from "./aiService";

function periodBundle() {
  return {
    range: { startDate: "2026-07-01", endDate: "2026-07-07", dayCount: 7 },
    totals: { calories: 9_800, protein: 630, carbs: 1_100, fat: 350 },
    daily: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-07-0${index + 1}`,
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
            title: "Resumo do período",
            summary: "Resumo objetivo.",
            summarySourceKeys: ["current_period"],
            facts: [],
            factSourceKeys: [],
            interpretations: ["A frequência foi consistente."],
            interpretationSourceKeys: [["current_record_frequency"]],
            missingData: [],
            cautions: [],
            draft: null,
            educationalNotice: "Aviso educativo.",
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: 120,
      completion_tokens: 40,
      total_tokens: 160,
    },
  };
}

describe("professional AI authorization and telemetry", () => {
  it("does not expose priorities when the professional profile is inactive", async () => {
    const listAlerts = vi.fn();
    const source = createProfessionalAiPriorityAlertSource({
      getStatus: vi.fn().mockResolvedValue({
        hasActiveProfile: false,
        profile: { active: false },
      }) as any,
      listAlerts,
    });

    await expect(source(1)).rejects.toThrow(
      "Área Profissional está indisponível"
    );
    expect(listAlerts).not.toHaveBeenCalled();
  });

  it("records only status, latency, model and safe counts", async () => {
    const logEvent = vi.fn();
    const now = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-07-20T12:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-07-20T12:00:00.250Z"));
    const service = createProfessionalAiService({
      getTimeZone: vi.fn().mockResolvedValue({
        timeZone: "America/Sao_Paulo",
        source: "profile",
      }),
      getPeriodBundle: vi.fn().mockResolvedValue(periodBundle()),
      listAlerts: vi.fn().mockResolvedValue([]),
      appendHistory: vi.fn().mockResolvedValue({}),
      logEvent,
      now,
      invoke: vi.fn().mockResolvedValue(providerResponse()),
    });

    await service.generate(1, {
      patientId: 41,
      startDate: "2026-07-01",
      endDate: "2026-07-07",
      mode: "question",
      question: "Compare os registros, segredo-do-paciente",
    });

    expect(logEvent).toHaveBeenCalledTimes(1);
    const event = logEvent.mock.calls[0][0];
    expect(event).toMatchObject({
      userId: 1,
      origin: "web",
      status: "success",
      eventType: "professional.ai.generation",
    });
    expect(JSON.parse(event.detail)).toEqual({
      durationMs: 250,
      outcome: "provider_success",
      fallbackCause: null,
      providerModel: "test-model",
      providerUsage: {
        promptTokens: 120,
        completionTokens: 40,
        totalTokens: 160,
      },
      sourceCount: 12,
    });
    expect(event.detail).not.toContain("segredo-do-paciente");
    expect(event.detail).not.toContain("Resumo objetivo");
  });
});
