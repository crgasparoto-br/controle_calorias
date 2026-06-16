import { beforeEach, describe, expect, it } from "vitest";
import { __resetWhatsappMessageHistoryForTests, recordWhatsappMessageHistory, type WhatsappMessageHistoryEntry } from "./messageHistory";
import {
  __resetWhatsappQualityMetricsForTests,
  buildWhatsappQualityMetricsReport,
  listWhatsappQualityMetricsReports,
  WHATSAPP_QUALITY_METRICS_POLICY,
  type WhatsappAutonomyMetricEvent,
  type WhatsappQualityFeedbackEvent,
} from "./qualityMetrics";

function intent(input: { confidence: number; intent?: "add_foods_to_meal" | "daily_summary"; brand?: string | null; quantity?: number | null }) {
  return {
    intent: input.intent ?? "add_foods_to_meal",
    confidence: input.confidence,
    date: "2026-06-16",
    meal: { label: "Almoco", createIfMissing: false },
    items: input.intent === "daily_summary" ? [] : [{ foodName: "iogurte", quantity: input.quantity ?? 1, unit: "un", brand: input.brand ?? undefined }],
    sourceFood: null,
    targetFood: null,
    quantity: input.quantity ? { value: input.quantity, unit: "g" } : null,
    requiresConfirmation: false,
    clarificationQuestion: null,
    possibleIntents: [],
    reason: "fixture",
  };
}

function entry(input: {
  createdAt: string;
  confidence: number;
  intent?: "add_foods_to_meal" | "daily_summary";
  brand?: string | null;
  quantity?: number | null;
  replyKind?: "executed" | "clarification" | "fallback" | "none";
  action?: string;
  status?: WhatsappMessageHistoryEntry["status"];
  correctionOfHistoryId?: number | null;
  estimated?: boolean | null;
  sourceId?: string | null;
  inputType?: WhatsappMessageHistoryEntry["inputType"];
  includeNutritionSource?: boolean;
}) {
  const includeNutritionSource = input.includeNutritionSource ?? input.intent !== "daily_summary";
  const estimated = input.estimated ?? !input.sourceId;
  return recordWhatsappMessageHistory({
    userId: 1,
    messageText: "mensagem de teste",
    normalizedInput: "mensagem de teste",
    inputType: input.inputType ?? "text",
    createdAt: new Date(input.createdAt),
    intent: intent({ confidence: input.confidence, intent: input.intent, brand: input.brand, quantity: input.quantity }),
    validationStatus: "valid",
    operationalTrace: { strategy: "llm_structured", modelName: "gpt-4.1-mini", latencyMs: 1200, estimatedCostUnits: 3 },
    action: input.action ?? "save_food",
    replyKind: input.replyKind ?? "executed",
    status: input.status,
    nutritionSource: includeNutritionSource ? {
      sourceId: input.sourceId ?? null,
      sourceType: input.sourceId ? "fabricante" : "estimativa",
      confidence: estimated ? 0.5 : 0.9,
      estimated,
    } : null,
    persisted: { happened: input.action !== "fallback_safe", kind: input.action === "fallback_safe" ? "none" : "meal", ids: input.action === "fallback_safe" ? [] : [101] },
    correctionOfHistoryId: input.correctionOfHistoryId ?? null,
  });
}

describe("whatsapp quality metrics", () => {
  beforeEach(() => {
    __resetWhatsappMessageHistoryForTests();
    __resetWhatsappQualityMetricsForTests();
  });

  it("documenta consulta protegida, rastreabilidade minima e integracoes", () => {
    expect(WHATSAPP_QUALITY_METRICS_POLICY).toEqual(expect.objectContaining({
      access: "protected_internal_query",
      highConfidenceThreshold: 0.85,
      lowConfidenceThreshold: 0.5,
      requiredTraceability: expect.arrayContaining(["intent", "inputType", "confidence", "versions", "nutritionSource", "status"]),
      integrations: expect.objectContaining({
        retentionPrivacy: "#432",
        feedback: "#430",
        promotion: "#431",
        drift: "#434",
        nutritionComparison: "#435",
        autonomy: "#436",
      }),
    }));
  });

  it("gera relatorio completo com feedback, autonomia e divergencia nutricional", () => {
    const entries = [
      entry({ createdAt: "2026-06-16T10:00:00.000Z", confidence: 0.92, brand: "Nestle", quantity: 170, sourceId: "fabricante-1" }),
      entry({ createdAt: "2026-06-16T10:05:00.000Z", confidence: 0.42, replyKind: "fallback", action: "fallback_safe", status: "low_confidence", estimated: true }),
      entry({ createdAt: "2026-06-16T10:10:00.000Z", confidence: 0.7, intent: "daily_summary", replyKind: "clarification", status: "ambiguous", inputType: "audio_transcript" }),
    ];
    const correction = entry({ createdAt: "2026-06-16T10:15:00.000Z", confidence: 0.88, brand: "Nestle", quantity: 100, sourceId: "fabricante-1", correctionOfHistoryId: entries[0].id });
    entries.push(correction);

    const feedback: WhatsappQualityFeedbackEvent[] = [
      { id: "fb-1", historyId: entries[0].id, createdAt: "2026-06-16T10:20:00.000Z", intent: "add_foods_to_meal", signal: "positive" },
      { id: "fb-2", historyId: entries[1].id, createdAt: "2026-06-16T10:21:00.000Z", intent: "add_foods_to_meal", signal: "negative" },
      { id: "fb-3", historyId: correction.id, createdAt: "2026-06-16T10:22:00.000Z", intent: "add_foods_to_meal", signal: "correction" },
    ];
    const autonomy: WhatsappAutonomyMetricEvent[] = [
      { id: "auto-1", historyId: entries[0].id, createdAt: "2026-06-16T10:00:00.000Z", intent: "add_foods_to_meal", outcome: "automatic", sensitive: false },
      { id: "auto-2", historyId: entries[1].id, createdAt: "2026-06-16T10:05:00.000Z", intent: "add_foods_to_meal", outcome: "blocked", sensitive: true },
      { id: "auto-3", historyId: entries[2].id, createdAt: "2026-06-16T10:10:00.000Z", intent: "daily_summary", outcome: "confirmation", sensitive: false },
      { id: "auto-4", historyId: correction.id, createdAt: "2026-06-16T10:15:00.000Z", intent: "add_foods_to_meal", outcome: "review", sensitive: true },
    ];

    const report = buildWhatsappQualityMetricsReport({
      entries,
      feedback,
      autonomy,
      nutritionComparisons: [
        { id: "cmp-1", historyId: entries[1].id, createdAt: "2026-06-16T11:00:00.000Z", caloriesEstimated: 240, caloriesConfirmed: 180, category: "iogurte", brand: "sem_marca", preparation: "tradicional" },
        { id: "cmp-2", historyId: entries[0].id, createdAt: "2026-06-16T11:05:00.000Z", caloriesEstimated: 130, caloriesConfirmed: 150, category: "iogurte", brand: "Nestle", preparation: "natural" },
      ],
      promotionPlans: [{ stage: "shadow" }, { stage: "rejected" }],
      createdAt: new Date("2026-06-16T12:00:00.000Z"),
    });

    expect(report).toEqual(expect.objectContaining({
      access: "protected_internal_query",
      createdAt: "2026-06-16T12:00:00.000Z",
      period: { from: "2026-06-16T10:00:00.000Z", to: "2026-06-16T10:15:00.000Z" },
      policyVersion: "whatsapp-quality-metrics/v1",
    }));
    expect(report.totals).toEqual(expect.objectContaining({
      messages: 4,
      highConfidenceRate: 0.5,
      lowConfidenceRate: 0.25,
      ambiguityRate: 0.25,
      fallbackSafeRate: 0.25,
      laterCorrectionRate: 0.5,
      feedbackPositive: 1,
      feedbackNegative: 1,
      feedbackCorrections: 1,
      brandRecognized: 2,
      specificNutritionSources: 2,
      estimatedNutritionSources: 1,
      averageNutritionCalorieError: 40,
      sensitiveBlockedOrReviewed: 2,
    }));
    expect(report.totals.actionsByAutonomy).toEqual({ automatic: 1, confirmation: 1, review: 1, blocked: 1 });
    expect(report.totals.promotionCandidates).toEqual(expect.objectContaining({ shadow: 1, rejected: 1 }));
    expect(report.nutritionDivergence[0]).toEqual({ key: "iogurte|sem_marca|tradicional", count: 1, averageCalorieError: 60 });
  });

  it("segmenta por intencao, modalidade e versao para orientar drift", () => {
    const entries = [
      entry({ createdAt: "2026-06-16T10:00:00.000Z", confidence: 0.92, brand: "Nestle", quantity: 170, sourceId: "fabricante-1" }),
      entry({ createdAt: "2026-06-16T10:05:00.000Z", confidence: 0.42, replyKind: "fallback", action: "fallback_safe", status: "low_confidence", estimated: true }),
      entry({ createdAt: "2026-06-16T10:10:00.000Z", confidence: 0.7, intent: "daily_summary", replyKind: "clarification", status: "ambiguous", inputType: "audio_transcript" }),
    ];

    const report = buildWhatsappQualityMetricsReport({ entries });
    const specificFoodSegment = report.segments.find(segment => segment.intent === "add_foods_to_meal" && segment.version.nutritionSourceVersion === "fabricante");
    const estimatedFoodSegment = report.segments.find(segment => segment.intent === "add_foods_to_meal" && segment.version.nutritionSourceVersion === "estimativa");
    const summarySegment = report.segments.find(segment => segment.intent === "daily_summary");

    expect(specificFoodSegment).toEqual(expect.objectContaining({
      inputType: "text",
      sampleSize: 1,
      highConfidenceRate: 1,
      lowConfidenceRate: 0,
      fallbackSafeRate: 0,
      brandRecognitionRate: 1,
      specificNutritionSourceRate: 1,
    }));
    expect(estimatedFoodSegment).toEqual(expect.objectContaining({
      inputType: "text",
      sampleSize: 1,
      highConfidenceRate: 0,
      lowConfidenceRate: 1,
      fallbackSafeRate: 1,
      brandRecognitionRate: 0,
      estimatedNutritionRate: 1,
    }));
    expect(summarySegment).toEqual(expect.objectContaining({ inputType: "audio_transcript", ambiguityRate: 1 }));
    expect(report.driftSnapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        intent: "add_foods_to_meal",
        sampleSize: 1,
        metrics: expect.objectContaining({ low_confidence_rate: 1, fallback_rate: 1, brand_recognition_rate: 0 }),
      }),
    ]));
  });

  it("mantem historico de relatorios gerados para consulta interna", () => {
    const entries = [entry({ createdAt: "2026-06-16T10:00:00.000Z", confidence: 0.92, brand: "Nestle", quantity: 170, sourceId: "fabricante-1" })];

    const report = buildWhatsappQualityMetricsReport({ entries });

    expect(listWhatsappQualityMetricsReports()).toEqual([report]);
    expect(listWhatsappQualityMetricsReports({ access: "protected_internal_query" })).toEqual([report]);
  });
});
