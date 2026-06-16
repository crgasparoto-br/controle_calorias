import { describe, expect, it } from "vitest";
import { WHATSAPP_DRIFT_DETECTION_VERSION, type WhatsappDriftAnalysis, type WhatsappDriftSnapshot } from "./driftDetection";
import { WHATSAPP_GRADUAL_PROMOTION_VERSION, type WhatsappPromotionPlan } from "./gradualPromotion";
import {
  buildWhatsappLearningEngineStatus,
  WHATSAPP_LEARNING_ENGINE_POLICY,
  WHATSAPP_LEARNING_ENGINE_VERSION,
  type BuildWhatsappLearningEngineStatusInput,
} from "./learningEngine";
import { WHATSAPP_LEARNING_GOVERNANCE_VERSION } from "./learningGovernance";
import { WHATSAPP_LEARNING_VERSIONING_VERSION, type WhatsappDecisionVersionSnapshot } from "./learningVersioning";
import { WHATSAPP_QUALITY_METRICS_VERSION, type WhatsappQualityMetricsReport } from "./qualityMetrics";

function snapshot(): WhatsappDriftSnapshot {
  return {
    id: "snapshot-1",
    period: { from: "2026-06-01T00:00:00.000Z", to: "2026-06-07T23:59:59.000Z" },
    sampleSize: 80,
    intent: "add_foods_to_meal",
    inputType: "text",
    conversationMode: "single_turn",
    versions: {
      promptVersion: "whatsapp-prompt/v2",
      schemaVersion: "whatsapp-intent-schema/v1",
      modelName: "gpt-4.1-mini",
      ruleVersion: "whatsapp-global-rules/v1",
      nutritionSourceVersion: "nutrition-source/v1",
      classifierVersion: "intent-classifier/v1",
    },
    metrics: {
      low_confidence_rate: 0.08,
      fallback_rate: 0.03,
      ambiguity_rate: 0.04,
      later_correction_rate: 0.02,
      brand_recognition_rate: 0.84,
      quantity_recognition_rate: 0.9,
      intent_accuracy: 0.94,
      persistence_error_rate: 0,
    },
  };
}

function metrics(overrides: Partial<WhatsappQualityMetricsReport["totals"]> = {}): BuildWhatsappLearningEngineStatusInput["metricsReport"] {
  return {
    id: 3,
    totals: {
      messages: 80,
      highConfidenceRate: 0.78,
      lowConfidenceRate: 0.08,
      ambiguityRate: 0.04,
      fallbackSafeRate: 0.03,
      laterCorrectionRate: 0.02,
      feedbackPositive: 18,
      feedbackNegative: 2,
      feedbackCorrections: 1,
      brandRecognized: 52,
      specificNutritionSources: 46,
      estimatedNutritionSources: 5,
      averageNutritionCalorieError: 18,
      traceabilityCoverageRate: 0.98,
      actionsByAutonomy: { automatic: 52, confirmation: 20, review: 6, blocked: 2 },
      promotionCandidates: { draft: 0, shadow: 0, canary: 0, broad: 1, rejected: 0, rolled_back: 0 },
      ...overrides,
    },
    segments: [{
      key: "add_foods_to_meal|text|v2",
      intent: "add_foods_to_meal",
      inputType: "text",
      version: snapshot().versions,
      period: snapshot().period,
      sampleSize: 80,
      highConfidenceRate: 0.78,
      lowConfidenceRate: 0.08,
      ambiguityRate: 0.04,
      fallbackSafeRate: 0.03,
      laterCorrectionRate: 0.02,
      brandRecognitionRate: 0.84,
      specificNutritionSourceRate: 0.82,
      estimatedNutritionRate: 0.06,
      traceabilityCoverageRate: 0.98,
      autonomy: { automatic: 52, confirmation: 20, review: 6, blocked: 2 },
      feedback: { positive: 18, negative: 2, correction: 1 },
    }],
    driftSnapshots: [snapshot()],
    policyVersion: WHATSAPP_QUALITY_METRICS_VERSION,
    integrations: {
      retentionPrivacy: "#432",
      feedback: "#430",
      promotion: "#431",
      drift: "#434",
      nutritionComparison: "#435",
      autonomy: "#436",
    },
  };
}

function drift(decision: WhatsappDriftAnalysis["decision"] = "stable"): BuildWhatsappLearningEngineStatusInput["driftAnalysis"] {
  return {
    id: 5,
    decision,
    findings: decision === "stable" ? [] : [{
      id: "finding-1",
      severity: decision === "watch" ? "watch" : "critical",
      action: decision === "rollback_review" ? "review_rollback" : decision === "block_promotion" ? "block_promotion" : "send_to_review",
      metric: "persistence_error_rate",
      before: 0,
      after: 0.03,
      delta: 0.03,
      threshold: 0.02,
      segment: { intent: "add_foods_to_meal", inputType: "text", conversationMode: "single_turn" },
      versions: { baseline: snapshot().versions, current: snapshot().versions },
      reason: "Regressao critica em persistencia.",
    }],
    affectedVersions: [snapshot().versions],
    promotionImpact: decision === "stable" ? null : {
      planId: 9,
      stage: "canary",
      candidateVersion: "whatsapp-prompt/v2",
      action: decision === "rollback_review" ? "review_rollback" : decision === "block_promotion" ? "block_promotion" : "send_to_review",
      reason: "Drift exige bloqueio ou revisao.",
    },
    policyVersion: WHATSAPP_DRIFT_DETECTION_VERSION,
  };
}

function promotion(stage: WhatsappPromotionPlan["stage"] = "broad"): BuildWhatsappLearningEngineStatusInput["promotionPlan"] {
  return {
    id: 9,
    stage,
    candidate: {
      id: "candidate-9",
      name: "prompt-v2",
      artifactCategory: "prompt",
      currentVersion: "whatsapp-prompt/v1",
      candidateVersion: "whatsapp-prompt/v2",
      objective: "Reduzir baixa confianca sem aumentar persistencia errada.",
      risk: "medium",
      createdAt: "2026-06-16T20:00:00.000Z",
      createdBy: "technical_reviewer",
    },
    qualityGate: {
      decision: stage === "rejected" ? "reject" : "approve_broad",
      objectiveScore: 0.4,
      blockingFindings: [],
      warnings: [],
    },
    reprocessing: {
      decision: "approve",
      regressionCount: 0,
      highImpactCount: 0,
      examplesTotal: 80,
    },
    policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION,
  };
}

function candidate(overrides: Partial<NonNullable<BuildWhatsappLearningEngineStatusInput["governanceCandidates"]>[number]> = {}): NonNullable<BuildWhatsappLearningEngineStatusInput["governanceCandidates"]>[number] {
  return {
    id: 17,
    status: "promoted",
    kind: "global_rule",
    action: "propose_global_rule",
    scope: "global",
    evidence: [
      { source: "review_queue", reference: "414", summary: "Curadoria aprovou a candidata." },
      { source: "offline_replay", reference: "416", summary: "Replay sem regressao." },
    ],
    rollbackPlan: "Restaurar whatsapp-global-rules/v1.",
    version: "whatsapp-global-rules/v2",
    metric: "fallback_rate",
    directGlobalPromotionAllowed: false,
    governanceVersion: WHATSAPP_LEARNING_GOVERNANCE_VERSION,
    privacy: {
      kind: "candidate_rule",
      purpose: "global_learning",
      retentionClass: "global_aggregate",
      retentionDays: 730,
      rawTextAllowed: false,
      anonymizationRequired: true,
      globalPromotionAllowed: true,
      origin: "review-queue:414",
      scope: "global",
      anonymizationApplied: ["direct_identifier_redaction"],
      expiresAt: null,
      policyVersion: "ai-learning-privacy-v1",
    },
    ...overrides,
  };
}

function versionSnapshot(): BuildWhatsappLearningEngineStatusInput["versionSnapshot"] {
  return {
    promptVersion: "whatsapp-prompt/v2",
    schemaVersion: "whatsapp-intent-schema/v1",
    globalRuleVersion: "whatsapp-global-rules/v2",
    nutritionSourceVersion: "nutrition-source/v1",
    confidenceCalibratorVersion: "confidence-calibrator/v1",
    promotionPolicyVersion: "learning-promotion-policy/v1",
    governancePolicyVersion: "whatsapp-learning-governance/v1",
    versioningPolicy: WHATSAPP_LEARNING_VERSIONING_VERSION,
  } satisfies Pick<WhatsappDecisionVersionSnapshot, "promptVersion" | "schemaVersion" | "globalRuleVersion" | "nutritionSourceVersion" | "confidenceCalibratorVersion" | "promotionPolicyVersion" | "governancePolicyVersion" | "versioningPolicy">;
}

function baseInput(overrides: Partial<BuildWhatsappLearningEngineStatusInput> = {}): BuildWhatsappLearningEngineStatusInput {
  return {
    createdAt: new Date("2026-06-16T22:00:00.000Z"),
    metricsReport: metrics(),
    driftAnalysis: drift(),
    promotionPlan: promotion(),
    governanceCandidates: [candidate()],
    reviewQueue: [],
    versionSnapshot: versionSnapshot(),
    ...overrides,
  };
}

describe("whatsapp continuous learning engine", () => {
  it("documenta componentes e integracoes do motor auditavel", () => {
    expect(WHATSAPP_LEARNING_ENGINE_POLICY).toEqual(expect.objectContaining({
      directMutationAllowed: false,
      requiredComponents: expect.arrayContaining([
        "reviewQueue",
        "governance",
        "versioning",
        "reprocessing",
        "qualityGates",
        "gradualPromotion",
        "driftDetection",
        "qualityMetrics",
        "poisoningGuard",
      ]),
      integrations: expect.objectContaining({
        epic: "#397",
        reviewQueue: "#414",
        versioning: "#415",
        reprocessing: "#416",
        qualityMetrics: "#417",
        gradualPromotion: "#431",
        privacy: "#432",
        drift: "#434",
        governance: "#443",
        poisoningGuard: "#444",
        qualityGates: "#446",
      }),
    }));
  });

  it("libera promocao ampla quando todas as protecoes estao prontas", () => {
    const status = buildWhatsappLearningEngineStatus(baseInput());

    expect(status).toEqual(expect.objectContaining({
      createdAt: "2026-06-16T22:00:00.000Z",
      decision: "ready_for_broad",
      ready: true,
      blockingReasons: [],
      warnings: [],
    }));
    expect(status.audit).toEqual({
      learningEngineVersion: WHATSAPP_LEARNING_ENGINE_VERSION,
      metricsVersion: WHATSAPP_QUALITY_METRICS_VERSION,
      driftVersion: WHATSAPP_DRIFT_DETECTION_VERSION,
      governanceVersion: WHATSAPP_LEARNING_GOVERNANCE_VERSION,
      promotionVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION,
      versioningPolicy: WHATSAPP_LEARNING_VERSIONING_VERSION,
    });
    expect(status.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "qualityMetrics", status: "ready" }),
      expect.objectContaining({ key: "driftDetection", status: "ready" }),
      expect.objectContaining({ key: "poisoningGuard", status: "ready" }),
    ]));
  });

  it("bloqueia aprendizado quando rastreabilidade das metricas fica abaixo do minimo", () => {
    const status = buildWhatsappLearningEngineStatus(baseInput({
      metricsReport: metrics({ traceabilityCoverageRate: 0.72 }),
    }));

    expect(status.ready).toBe(false);
    expect(status.decision).toBe("blocked");
    expect(status.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "qualityMetrics", status: "blocked", reason: expect.stringContaining("Rastreabilidade") }),
    ]));
  });

  it("bloqueia promocao quando drift critico pede rollback ou bloqueio", () => {
    const rollbackStatus = buildWhatsappLearningEngineStatus(baseInput({ driftAnalysis: drift("rollback_review") }));
    const blockedStatus = buildWhatsappLearningEngineStatus(baseInput({ driftAnalysis: drift("block_promotion") }));

    expect(rollbackStatus.decision).toBe("rollback_review");
    expect(rollbackStatus.ready).toBe(false);
    expect(blockedStatus.decision).toBe("blocked");
    expect(blockedStatus.blockingReasons.join(" ")).toContain("Drift critico");
  });

  it("exige revisao quando fila tem item suspeito de alto impacto", () => {
    const status = buildWhatsappLearningEngineStatus(baseInput({
      reviewQueue: [{
        id: 88,
        status: "open",
        priority: "high",
        impact: "high",
        type: "negative_feedback",
        title: "Padrao suspeito de feedback negativo",
      }],
    }));

    expect(status.ready).toBe(false);
    expect(status.decision).toBe("needs_review");
    expect(status.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "reviewQueue", status: "needs_review" }),
      expect.objectContaining({ key: "poisoningGuard", status: "needs_review" }),
    ]));
  });

  it("bloqueia candidato global que tenta permitir promocao direta", () => {
    const status = buildWhatsappLearningEngineStatus(baseInput({
      governanceCandidates: [candidate({ directGlobalPromotionAllowed: true as false })],
    }));

    expect(status.ready).toBe(false);
    expect(status.decision).toBe("blocked");
    expect(status.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "governance", status: "blocked" }),
      expect.objectContaining({ key: "poisoningGuard", status: "blocked" }),
    ]));
  });
});
