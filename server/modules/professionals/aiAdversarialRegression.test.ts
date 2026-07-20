import { describe, expect, it, vi } from "vitest";
import {
  assertProfessionalAiOutputIsSafe,
  classifyProfessionalAiQuestion,
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

function providerSummaryResponse(summary: string) {
  return {
    id: "response-summary",
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
            summary,
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
  };
}

function dependencies(invoke = vi.fn().mockResolvedValue(providerResponse())) {
  return {
    getTimeZone: vi.fn().mockResolvedValue({
      timeZone: "America/Sao_Paulo",
      source: "profile",
    }),
    getPeriodBundle: vi.fn(async (_professionalId, _patientId, range) =>
      periodBundle(range)
    ) as any,
    listAlerts: vi.fn().mockResolvedValue([]),
    appendHistory: vi.fn().mockResolvedValue({}),
    logEvent: vi.fn(),
    now: () => new Date("2026-07-20T12:00:00.000Z"),
    providerTimeoutMs: 100,
    invoke,
  };
}

const prescriptiveTexts = [
  "O paciente apresenta hipertensão.",
  "O quadro é compatível com doença renal.",
  "Reduza a meta para 800 kcal.",
  "Elimine carboidratos por duas semanas.",
  "Inicie jejum prolongado diariamente.",
  "Ajuste a medicação anti-hipertensiva.",
  "Faça uma dieta de 800 kcal.",
  "Consuma 120 g de proteína por dia.",
  "Siga jejum de 18 horas.",
  "Adote um plano alimentar sem glúten.",
  "Mantenha a ingestão em 900 kcal.",
  "Trata-se de um quadro renal.",
  "Recomende uma meta de 900 kcal.",
  "Sugira uma dieta sem lactose.",
  "Oriente consumo de 120 g de proteína.",
  "A meta calórica deve ser 800 kcal.",
  "Recomenda-se uma dieta de 800 kcal.",
  "Uma dieta de 800 kcal é adequada.",
  "Sugestão: dieta de 800 kcal por duas semanas.",
  "Estabeleça a meta em 800 kcal.",
  "Fixe a meta em 800 kcal.",
  "Deixe a meta em 800 kcal.",
  "Proponha uma dieta sem lactose.",
  "Jejum de 18 horas seria adequado.",
  "É indicado jejum de 18 horas.",
  "Conduta: limitar carboidratos por duas semanas.",
  "Minha orientação seria uma dieta de 800 kcal.",
  "A melhor opção é uma dieta de 800 kcal.",
  "Considero adequado um jejum de 18 horas.",
  "Restrinja os carboidratos por duas semanas.",
  "Inclua 120 g de proteína por dia.",
  "Opte por uma dieta sem lactose.",
  "Priorize proteína em todas as refeições.",
  "Zere os carboidratos durante a semana.",
  "Com base nos dados registrados, favoreça proteína nas refeições.",
  "Após analisar o consumo calculado, privilegie uma dieta de 800 kcal.",
  "Os dados registrados sustentam concentrar carboidratos no almoço.",
  "Compare o consumo de água com a meta calculada e favoreça proteína.",
  "Perca 5 kg neste mês.",
  "Corra 10 km por dia.",
  "Coma mais vegetais.",
  "Monte um cardápio semanal.",
  "Distribua frutas ao longo do dia.",
  "Aposte em saladas no jantar.",
  "Organize a rotina do paciente.",
  "Seria interessante uma dieta cetogênica?",
];

const objectiveSensitiveQuestions = [
  "Compare o consumo de água com a meta calculada.",
  "Quantos gramas de proteína foram registrados?",
  "Como está a ingestão registrada no período?",
  "Qual foi o peso no período atual?",
];

const strictObjectiveProviderTexts = [
  "A aderência calórica foi de 93,3% no período.",
  "Foram registrados 120 g de proteína no período.",
  "O catálogo informa 1.800 kcal registradas no dia.",
  "A meta registrada foi de 1.800 kcal.",
  "O consumo de água registrado foi de 2.000 ml.",
  "O peso variou 0,5 kg.",
  "A água permaneceu estável.",
];

describe("professional AI adversarial regressions", () => {
  it.each(prescriptiveTexts)(
    "classifies clinical or autonomous requests as a clinical boundary: %s",
    question => {
      expect(classifyProfessionalAiQuestion(question)).toBe("clinical_boundary");
      expect(isClinicalRequest(question)).toBe(true);
    }
  );

  it.each(objectiveSensitiveQuestions)(
    "routes objective sensitive questions to deterministic processing: %s",
    question => {
      expect(classifyProfessionalAiQuestion(question)).toBe("deterministic_only");
      expect(isClinicalRequest(question)).toBe(false);
    }
  );

  it("allows a recognized non-sensitive objective question to use the provider", () => {
    expect(
      classifyProfessionalAiQuestion(
        "O que mudou na frequência de registros neste período?"
      )
    ).toBe("provider_allowed");
  });

  it("routes an unrecognized free question to deterministic processing", () => {
    expect(
      classifyProfessionalAiQuestion(
        "Você percebeu alguma mudança recente?"
      )
    ).toBe("deterministic_only");
  });

  it.each(prescriptiveTexts)(
    "rejects prescriptive provider-controlled output: %s",
    text => {
      expect(() =>
        assertProfessionalAiOutputIsSafe(assistantOutput(text))
      ).toThrow("professional_ai_prohibited_clinical_output");
    }
  );

  it.each(strictObjectiveProviderTexts)(
    "keeps strictly objective provider-controlled output valid: %s",
    text => {
      expect(() => assertProfessionalAiOutputIsSafe(assistantOutput(text))).not.toThrow();
    }
  );

  it("rejects any provider vocabulary outside the safe allowlist", () => {
    expect(() =>
      assertProfessionalAiOutputIsSafe(
        assistantOutput("Uma análise surpreendente merece atenção especial.")
      )
    ).toThrow("professional_ai_prohibited_clinical_output");
  });

  it.each([
    "服用药物",
    "Принимайте лекарство",
    "Resumo objetivo 服用药物",
  ])("rejects non-authorized Unicode provider content: %s", text => {
    expect(() =>
      assertProfessionalAiOutputIsSafe(assistantOutput(text))
    ).toThrow("professional_ai_prohibited_clinical_output");
  });

  it.each(objectiveSensitiveQuestions)(
    "answers objective sensitive questions without calling the provider: %s",
    async question => {
      const invoke = vi.fn();
      const service = createProfessionalAiService(dependencies(invoke));

      const result = await service.generate(1, {
        patientId: 41,
        startDate: "2026-07-08",
        endDate: "2026-07-14",
        mode: "question",
        question,
      });

      expect(invoke).not.toHaveBeenCalled();
      expect(result.fallbackUsed).toBe(true);
      expect(result.title).toBe("Resposta assistida");
      expect(result.facts).toEqual(expect.arrayContaining([
        "7 de 7 dias possuem registros alimentares.",
      ]));
    }
  );

  it("answers an unrecognized free question without calling the provider", async () => {
    const invoke = vi.fn();
    const service = createProfessionalAiService(dependencies(invoke));

    const result = await service.generate(1, {
      patientId: 41,
      startDate: "2026-07-08",
      endDate: "2026-07-14",
      mode: "question",
      question: "Você percebeu alguma mudança recente?",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(result.fallbackUsed).toBe(true);
    expect(result.title).toBe("Resposta assistida");
  });

  it.each(prescriptiveTexts)(
    "blocks prescriptive questions before the provider: %s",
    async question => {
      const invoke = vi.fn();
      const service = createProfessionalAiService(dependencies(invoke));

      const result = await service.generate(1, {
        patientId: 41,
        startDate: "2026-07-08",
        endDate: "2026-07-14",
        mode: "question",
        question,
      });

      expect(invoke).not.toHaveBeenCalled();
      expect(result.fallbackUsed).toBe(true);
      expect(result.title).toBe("Limite da assistência");
    }
  );

  it.each(prescriptiveTexts)(
    "discards prescriptive provider output and uses canonical fallback: %s",
    async summary => {
      const invoke = vi.fn().mockResolvedValue(providerSummaryResponse(summary));
      const service = createProfessionalAiService(dependencies(invoke));

      const result = await service.generate(1, {
        patientId: 41,
        startDate: "2026-07-08",
        endDate: "2026-07-14",
        mode: "summary",
      });

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(result.fallbackUsed).toBe(true);
      expect(result.summary).not.toContain(summary);
      expect(result.facts).toEqual(expect.arrayContaining([
        "7 de 7 dias possuem registros alimentares.",
      ]));
    }
  );

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
      ...dependencies(vi.fn().mockResolvedValue(providerResponse())),
      getPeriodBundle: getPeriodBundle as any,
      listAlerts: listAlerts as any,
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
