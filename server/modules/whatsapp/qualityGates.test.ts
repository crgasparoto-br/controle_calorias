import { describe, expect, it } from "vitest";
import {
  evaluateWhatsappAiQualityGates,
  WHATSAPP_AI_OBJECTIVE_PRIORITY,
  WHATSAPP_AI_QUALITY_GATES_POLICY,
  type WhatsappQualityGateInput,
  type WhatsappQualityGateMetricSet,
} from "./qualityGates";

const baseMetrics: WhatsappQualityGateMetricSet = {
  false_positive_food_rate: 0.02,
  wrong_persistence_rate: 0,
  wrong_removal_rate: 0,
  unconfirmed_goal_change_rate: 0,
  unsafe_sensitive_health_rate: 0,
  prompt_injection_failure_rate: 0,
  professional_action_without_confirmation_rate: 0,
  intent_accuracy: 0.86,
  entity_accuracy: 0.8,
  nutrition_source_specificity: 0.58,
  calibrated_low_confidence_rate: 0.18,
  later_correction_rate: 0.07,
  nutrition_divergence_rate: 0.08,
  user_rework_rate: 0.09,
  p95_latency_ms: 900,
  cost_per_message: 0.04,
};

function input(overrides: Partial<WhatsappQualityGateInput> = {}): WhatsappQualityGateInput {
  return {
    candidateId: "candidate-1",
    candidateName: "prompt-v2",
    action: "propose_prompt_change",
    changeKind: "prompt",
    targetStage: "broad",
    declaredObjective: "Reduzir baixa confianca sem aumentar acoes indevidas.",
    intendedMetricImprovements: ["intent_accuracy", "calibrated_low_confidence_rate", "later_correction_rate"],
    actionRisk: "persistent_tool",
    period: { from: "2026-06-16T00:00:00.000Z", to: "2026-06-16T23:59:59.000Z" },
    sampleSize: 180,
    coverage: {
      positiveCases: 70,
      negativeCases: 28,
      ambiguousCases: 16,
      multiTurnCases: 14,
      promptInjectionCases: 6,
      sensitiveHealthCases: 5,
    },
    before: baseMetrics,
    after: {
      ...baseMetrics,
      intent_accuracy: 0.9,
      entity_accuracy: 0.84,
      nutrition_source_specificity: 0.66,
      calibrated_low_confidence_rate: 0.12,
      later_correction_rate: 0.05,
      user_rework_rate: 0.06,
    },
    versions: {
      candidateVersion: "whatsapp-prompt/v2",
      promptVersion: "whatsapp-prompt/v2",
      schemaVersion: "whatsapp-intent-schema/v1",
      ruleVersion: "whatsapp-global-rules/v1",
      calibrationVersion: "whatsapp-confidence-calibration/v1",
      governanceVersion: "whatsapp-learning-governance/v1",
      datasetVersion: "whatsapp-regression-dataset/v1",
    },
    reprocessing: { decision: "approve", regressionCount: 0, highImpactCount: 0, examplesTotal: 80 },
    ...overrides,
  };
}

describe("whatsapp ai quality gates", () => {
  it("documenta funcao de objetivo, prioridades e integracoes", () => {
    expect(WHATSAPP_AI_OBJECTIVE_PRIORITY).toEqual([
      "seguranca_privacidade_acoes_indevidas",
      "evitar_persistencia_errada_alteracao_destrutiva_acao_profissional_indevida",
      "acuracia_intencao_entidade_quantidade_data_fonte_acao_final",
      "robustez_negativos_ambiguos_multiturn",
      "reducao_atrito_sem_sacrificar_seguranca",
      "custo_latencia_estabilidade_operacional",
    ]);
    expect(WHATSAPP_AI_QUALITY_GATES_POLICY).toEqual(expect.objectContaining({
      objectiveFunction: expect.stringContaining("Bloqueadores criticos"),
      stageRequirements: expect.objectContaining({
        shadow: expect.objectContaining({ minSampleSize: 10 }),
        canary: expect.objectContaining({ minSampleSize: 50 }),
        broad: expect.objectContaining({ minSampleSize: 120 }),
      }),
      integrations: expect.objectContaining({
        metrics: "#417",
        drift: "#431",
        knowledgeValidity: "#434",
        negativeEvaluation: "#441",
        governance: "#443",
        security: "#444",
        confidenceCalibration: "#445",
      }),
    }));
  });

  it("rejeita mudanca que melhora acuracia geral mas falha em caso critico", () => {
    const result = evaluateWhatsappAiQualityGates(input({
      after: {
        ...baseMetrics,
        intent_accuracy: 0.94,
        entity_accuracy: 0.9,
        calibrated_low_confidence_rate: 0.1,
        prompt_injection_failure_rate: 0.01,
      },
    }));

    expect(result.decision).toBe("reject");
    expect(result.improvements).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "intent_accuracy" }),
      expect.objectContaining({ metric: "calibrated_low_confidence_rate" }),
    ]));
    expect(result.blockingFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "prompt_injection_failure_rate", severity: "blocking" }),
    ]));
  });

  it("aprova sombra mas nao promocao ampla quando a amostra e baixa", () => {
    const lowSample = input({
      targetStage: "shadow",
      sampleSize: 18,
      coverage: { positiveCases: 8, negativeCases: 4, ambiguousCases: 2, multiTurnCases: 2, promptInjectionCases: 1, sensitiveHealthCases: 1 },
    });

    const shadow = evaluateWhatsappAiQualityGates(lowSample);
    const broad = evaluateWhatsappAiQualityGates({ ...lowSample, targetStage: "broad" });

    expect(shadow.decision).toBe("approve_shadow");
    expect(broad.decision).toBe("reject");
    expect(broad.blockingFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ gate: "sample_size" }),
      expect.objectContaining({ gate: "coverage:negativeCases" }),
      expect.objectContaining({ gate: "coverage:multiTurnCases" }),
    ]));
  });

  it("aciona rollback quando uma metrica bloqueante piora apos promocao", () => {
    const result = evaluateWhatsappAiQualityGates(input({
      targetStage: "rollback",
      sampleSize: 30,
      coverage: { positiveCases: 5, negativeCases: 3, ambiguousCases: 1, multiTurnCases: 1, promptInjectionCases: 1, sensitiveHealthCases: 1 },
      after: { ...baseMetrics, wrong_persistence_rate: 0.02 },
      reprocessing: { decision: "reject", regressionCount: 1, highImpactCount: 1, examplesTotal: 30 },
    }));

    expect(result.decision).toBe("rollback");
    expect(result.blockingFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: "wrong_persistence_rate" }),
      expect.objectContaining({ gate: "reprocessing" }),
    ]));
  });

  it("considera cobertura de casos negativos e multi-turn antes de canary", () => {
    const result = evaluateWhatsappAiQualityGates(input({
      targetStage: "canary",
      sampleSize: 75,
      coverage: {
        positiveCases: 35,
        negativeCases: 4,
        ambiguousCases: 8,
        multiTurnCases: 2,
        promptInjectionCases: 3,
        sensitiveHealthCases: 3,
      },
    }));

    expect(result.decision).toBe("reject");
    expect(result.blockingFindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ gate: "coverage:negativeCases" }),
      expect.objectContaining({ gate: "coverage:multiTurnCases" }),
    ]));
  });

  it("aprova promocao ampla com registro auditavel dos criterios", () => {
    const result = evaluateWhatsappAiQualityGates(input());

    expect(result.decision).toBe("approve_broad");
    expect(result.objectiveScore).toBeGreaterThan(0);
    expect(result.blockingFindings).toHaveLength(0);
    expect(result.audit).toEqual(expect.objectContaining({
      period: { from: "2026-06-16T00:00:00.000Z", to: "2026-06-16T23:59:59.000Z" },
      declaredObjective: "Reduzir baixa confianca sem aumentar acoes indevidas.",
      sampleSize: 180,
      policyVersion: "whatsapp-ai-quality-gates/v1",
    }));
    expect(result.audit.versions).toEqual(expect.objectContaining({
      promptVersion: "whatsapp-prompt/v2",
      datasetVersion: "whatsapp-regression-dataset/v1",
    }));
  });
});
