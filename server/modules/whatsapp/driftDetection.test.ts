import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappDriftDetectionForTests,
  analyzeWhatsappAiDrift,
  listWhatsappDriftAnalyses,
  WHATSAPP_DRIFT_DETECTION_POLICY,
  type WhatsappDriftSnapshot,
} from "./driftDetection";
import type { WhatsappPromotionPlan } from "./gradualPromotion";

function versions(overrides: Partial<WhatsappDriftSnapshot["versions"]> = {}): WhatsappDriftSnapshot["versions"] {
  return {
    promptVersion: "whatsapp-prompt/v1",
    schemaVersion: "whatsapp-intent-schema/v1",
    modelName: "gpt-4.1-mini",
    ruleVersion: "whatsapp-rules/v1",
    nutritionSourceVersion: "nutrition-sources/v1",
    classifierVersion: "intent-classifier/v1",
    ...overrides,
  };
}

function snapshot(overrides: Partial<WhatsappDriftSnapshot> = {}): WhatsappDriftSnapshot {
  return {
    id: "baseline-add-food-text",
    period: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-07T23:59:59.000Z" },
    sampleSize: 120,
    intent: "add_foods_to_meal",
    inputType: "text",
    conversationMode: "single_turn",
    versions: versions(),
    metrics: {
      low_confidence_rate: 0.12,
      fallback_rate: 0.06,
      ambiguity_rate: 0.08,
      later_correction_rate: 0.04,
      brand_recognition_rate: 0.78,
      product_recognition_rate: 0.82,
      quantity_recognition_rate: 0.88,
      relative_date_success_rate: 0.86,
      action_accuracy_rate: 0.9,
      intent_accuracy: 0.92,
      persistence_error_rate: 0,
    },
    ...overrides,
  };
}

function promotion(stage: WhatsappPromotionPlan["stage"] = "shadow"): Pick<WhatsappPromotionPlan, "id" | "stage" | "candidate"> {
  return {
    id: 7,
    stage,
    candidate: {
      id: "candidate-7",
      name: "prompt-v2",
      artifactCategory: "prompt",
      currentVersion: "whatsapp-prompt/v1",
      candidateVersion: "whatsapp-prompt/v2",
      objective: "Reduzir fallback sem aumentar erro de persistencia.",
      risk: "medium",
      createdAt: "2026-06-16T20:00:00.000Z",
      createdBy: "technical_reviewer",
    },
  };
}

describe("whatsapp ai drift detection", () => {
  beforeEach(() => {
    __resetWhatsappDriftDetectionForTests();
  });

  it("documenta metricas, segmentacao e integracoes da politica de drift", () => {
    expect(WHATSAPP_DRIFT_DETECTION_POLICY).toEqual(expect.objectContaining({
      minimumSampleSize: 20,
      segmentKeys: ["intent", "inputType", "conversationMode"],
      metrics: expect.objectContaining({
        low_confidence_rate: expect.objectContaining({ direction: "increase" }),
        fallback_rate: expect.objectContaining({ direction: "increase" }),
        brand_recognition_rate: expect.objectContaining({ direction: "decrease" }),
        relative_date_success_rate: expect.objectContaining({ direction: "decrease" }),
        persistence_error_rate: expect.objectContaining({ direction: "increase" }),
      }),
      integrations: expect.objectContaining({
        metrics: "#417",
        reprocessing: "#416",
        multiTurnRegression: "#428",
        orchestration: "#429",
        promotion: "#431",
      }),
    }));
  });

  it("retorna estavel quando o periodo atual nao degrada as metricas", () => {
    const result = analyzeWhatsappAiDrift({
      baseline: [snapshot()],
      current: [snapshot({
        id: "current-add-food-text",
        period: { from: "2026-06-08T00:00:00.000Z", to: "2026-06-14T23:59:59.000Z" },
        versions: versions({ promptVersion: "whatsapp-prompt/v2" }),
        metrics: {
          ...snapshot().metrics,
          low_confidence_rate: 0.1,
          fallback_rate: 0.04,
          intent_accuracy: 0.94,
        },
      })],
      promotionPlan: promotion("shadow"),
      createdAt: new Date("2026-06-16T21:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      decision: "stable",
      findings: [],
      createdAt: "2026-06-16T21:00:00.000Z",
      policyVersion: "whatsapp-drift-detection/v1",
    }));
    expect(result.promotionImpact).toEqual(expect.objectContaining({ action: "none" }));
  });

  it("detecta aumento de baixa confianca e fallback por versao e periodo", () => {
    const result = analyzeWhatsappAiDrift({
      baseline: [snapshot()],
      current: [snapshot({
        id: "current-add-food-text",
        period: { from: "2026-06-08T00:00:00.000Z", to: "2026-06-14T23:59:59.000Z" },
        versions: versions({ promptVersion: "whatsapp-prompt/v2" }),
        metrics: {
          ...snapshot().metrics,
          low_confidence_rate: 0.21,
          fallback_rate: 0.14,
        },
      })],
    });

    expect(result.decision).toBe("review");
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "low_confidence_rate", severity: "review", delta: 0.09 }),
      expect.objectContaining({ metric: "fallback_rate", severity: "review", delta: 0.08 }),
    ]));
    expect(result.affectedVersions).toEqual([expect.objectContaining({ promptVersion: "whatsapp-prompt/v2" })]);
  });

  it("segmenta degradacao por modalidade, intencao e conversa multi-turn", () => {
    const baselineAudio = snapshot({
      id: "baseline-question-audio",
      intent: "nutrition_question",
      inputType: "audio",
      conversationMode: "multi_turn",
      metrics: { ...snapshot().metrics, action_accuracy_rate: 0.88 },
    });
    const currentAudio = snapshot({
      ...baselineAudio,
      id: "current-question-audio",
      period: { from: "2026-06-08T00:00:00.000Z", to: "2026-06-14T23:59:59.000Z" },
      versions: versions({ modelName: "gpt-4.1-mini-2026-06" }),
      metrics: { ...baselineAudio.metrics, action_accuracy_rate: 0.78 },
    });

    const result = analyzeWhatsappAiDrift({ baseline: [snapshot(), baselineAudio], current: [snapshot(), currentAudio] });

    expect(result.decision).toBe("review");
    expect(result.findings).toEqual([expect.objectContaining({
      metric: "action_accuracy_rate",
      segment: { intent: "nutrition_question", inputType: "audio", conversationMode: "multi_turn" },
    })]);
  });

  it("bloqueia promocao quando drift critico atinge metrica bloqueante", () => {
    const result = analyzeWhatsappAiDrift({
      baseline: [snapshot()],
      current: [snapshot({
        id: "current-add-food-text",
        versions: versions({ promptVersion: "whatsapp-prompt/v2" }),
        metrics: { ...snapshot().metrics, persistence_error_rate: 0.03 },
      })],
      promotionPlan: promotion("shadow"),
    });

    expect(result.decision).toBe("block_promotion");
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "persistence_error_rate", severity: "critical", action: "block_promotion" }),
    ]));
    expect(result.promotionImpact).toEqual(expect.objectContaining({
      planId: 7,
      action: "block_promotion",
      candidateVersion: "whatsapp-prompt/v2",
    }));
  });

  it("recomenda revisar rollback quando versao em canary degrada criticamente", () => {
    const result = analyzeWhatsappAiDrift({
      baseline: [snapshot()],
      current: [snapshot({
        id: "current-add-food-text",
        versions: versions({ promptVersion: "whatsapp-prompt/v2" }),
        metrics: { ...snapshot().metrics, later_correction_rate: 0.14 },
      })],
      promotionPlan: promotion("canary"),
    });

    expect(result.decision).toBe("rollback_review");
    expect(result.promotionImpact).toEqual(expect.objectContaining({ action: "review_rollback", stage: "canary" }));
  });

  it("ignora segmentos com amostra insuficiente para evitar falso alarme", () => {
    const result = analyzeWhatsappAiDrift({
      baseline: [snapshot({ sampleSize: 12 })],
      current: [snapshot({ sampleSize: 12, metrics: { ...snapshot().metrics, fallback_rate: 0.4 } })],
    });

    expect(result.decision).toBe("stable");
    expect(result.findings).toHaveLength(0);
    expect(listWhatsappDriftAnalyses()).toHaveLength(1);
  });
});
