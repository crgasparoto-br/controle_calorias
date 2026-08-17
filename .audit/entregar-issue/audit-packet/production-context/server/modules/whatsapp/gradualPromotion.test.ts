import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappGradualPromotionForTests,
  advanceWhatsappPromotion,
  createWhatsappPromotionPlan,
  evaluateWhatsappPromotionReadiness,
  listWhatsappPromotionPlans,
  recordWhatsappShadowComparison,
  rollbackWhatsappPromotion,
  WHATSAPP_GRADUAL_PROMOTION_POLICY,
  type WhatsappPromotionPlan,
} from "./gradualPromotion";
import type { WhatsappQualityGateResult } from "./qualityGates";
import type { WhatsappReprocessingRun } from "./learningReprocessing";

function candidate() {
  return {
    id: "candidate-1",
    name: "prompt-v2",
    artifactCategory: "prompt" as const,
    currentVersion: "whatsapp-prompt/v1",
    candidateVersion: "whatsapp-prompt/v2",
    objective: "Reduzir baixa confianca sem aumentar falso positivo alimentar.",
    risk: "medium" as const,
    createdBy: "technical_reviewer",
    createdAt: new Date("2026-06-16T20:00:00.000Z"),
  };
}

function gate(decision: WhatsappQualityGateResult["decision"]): WhatsappPromotionPlan["qualityGate"] {
  return {
    decision,
    objectiveScore: decision === "reject" ? -0.4 : 0.42,
    blockingFindings: decision === "reject" ? [{ gate: "blocking_metric", severity: "blocking", metric: "false_positive_food_rate", message: "Falso positivo piorou." }] : [],
    warnings: [],
  };
}

function reprocessing(overrides: Partial<Pick<WhatsappReprocessingRun, "decision" | "regressionCount" | "highImpactCount" | "examplesTotal">> = {}): WhatsappPromotionPlan["reprocessing"] {
  return {
    decision: "approve",
    regressionCount: 0,
    highImpactCount: 0,
    examplesTotal: 42,
    ...overrides,
  };
}

describe("whatsapp gradual promotion", () => {
  beforeEach(() => {
    __resetWhatsappGradualPromotionForTests();
  });

  it("documenta estagios, metricas e integracoes do fluxo gradual", () => {
    expect(WHATSAPP_GRADUAL_PROMOTION_POLICY).toEqual(expect.objectContaining({
      directProductionChangeAllowed: false,
      stages: expect.objectContaining({
        shadow: expect.stringContaining("sem aplicar decisao"),
        canary: expect.stringContaining("escopo controlado"),
        broad: expect.stringContaining("gates objetivos"),
        rollback: expect.stringContaining("Restaura versao anterior"),
      }),
      requiredMetrics: expect.arrayContaining(["false_positive_food_rate", "wrong_persistence_rate", "intent_accuracy", "p95_latency_ms"]),
      integrations: expect.objectContaining({
        versioning: "#415",
        reprocessing: "#416",
        metrics: "#417",
        orchestration: "#429",
        feedbackLoop: "#430",
        drift: "#434",
        qualityGates: "#446",
      }),
    }));
  });

  it("cria plano e inicia modo sombra sem afetar usuarios", () => {
    const plan = createWhatsappPromotionPlan({ candidate: candidate() });
    const advanced = advanceWhatsappPromotion({
      planId: plan.id,
      actor: "system",
      targetStage: "shadow",
      advancedAt: new Date("2026-06-16T20:05:00.000Z"),
    });

    expect(advanced?.evaluation).toEqual(expect.objectContaining({ allowed: true, decision: "shadow_started" }));
    expect(advanced?.plan).toEqual(expect.objectContaining({
      stage: "shadow",
      scope: "internal",
      percentage: 0,
      policyVersion: "whatsapp-gradual-promotion/v1",
    }));
    expect(advanced?.plan.decisions).toEqual([expect.objectContaining({ fromStage: "draft", toStage: "shadow" })]);
  });

  it("registra comparacao entre comportamento atual e candidato em sombra", () => {
    const plan = createWhatsappPromotionPlan({ candidate: candidate() });
    advanceWhatsappPromotion({ planId: plan.id, actor: "system", targetStage: "shadow" });

    const comparison = recordWhatsappShadowComparison({
      planId: plan.id,
      comparison: {
        messageId: "msg-1",
        intent: "add_foods_to_meal",
        currentDecision: "ask_clarification",
        candidateDecision: "save_food",
        currentPersisted: false,
        candidatePersisted: true,
        currentConfidence: 0.62,
        candidateConfidence: 0.84,
        outcome: "candidate_better",
        reason: "Candidata resolveu entidade e quantidade sem violar persistencia.",
      },
    });

    expect(comparison).toEqual(expect.objectContaining({
      id: "shadow-1-1",
      currentVersion: "whatsapp-prompt/v1",
      candidateVersion: "whatsapp-prompt/v2",
      outcome: "candidate_better",
    }));
    expect(listWhatsappPromotionPlans({ stage: "shadow" })[0].shadowComparisons).toHaveLength(1);
  });

  it("bloqueia canary quando nao houve sombra previa", () => {
    const plan = createWhatsappPromotionPlan({ candidate: candidate() });
    const result = advanceWhatsappPromotion({
      planId: plan.id,
      actor: "technical_reviewer",
      targetStage: "canary",
      qualityGate: gate("approve_canary"),
      reprocessing: reprocessing(),
    });

    expect(result?.evaluation).toEqual(expect.objectContaining({
      allowed: false,
      decision: "review_required",
      reason: expect.stringContaining("Canary exige"),
    }));
    expect(result?.plan.stage).toBe("draft");
  });

  it("inicia canary com escopo controlado apos sombra e gates", () => {
    const plan = createWhatsappPromotionPlan({ candidate: candidate() });
    advanceWhatsappPromotion({ planId: plan.id, actor: "system", targetStage: "shadow" });

    const result = advanceWhatsappPromotion({
      planId: plan.id,
      actor: "technical_reviewer",
      targetStage: "canary",
      scope: "percentage",
      percentage: 5,
      qualityGate: gate("approve_canary"),
      reprocessing: reprocessing(),
      advancedAt: new Date("2026-06-16T20:20:00.000Z"),
    });

    expect(result?.evaluation).toEqual(expect.objectContaining({ allowed: true, decision: "canary_started" }));
    expect(result?.plan).toEqual(expect.objectContaining({
      stage: "canary",
      scope: "percentage",
      percentage: 5,
      updatedAt: "2026-06-16T20:20:00.000Z",
    }));
  });

  it("promove amplamente apenas apos canary, gate amplo e reprocessamento sem regressao", () => {
    const plan = createWhatsappPromotionPlan({ candidate: candidate() });
    advanceWhatsappPromotion({ planId: plan.id, actor: "system", targetStage: "shadow" });
    advanceWhatsappPromotion({ planId: plan.id, actor: "technical_reviewer", targetStage: "canary", qualityGate: gate("approve_canary"), reprocessing: reprocessing(), percentage: 3 });

    const result = advanceWhatsappPromotion({
      planId: plan.id,
      actor: "administrator",
      targetStage: "broad",
      qualityGate: gate("approve_broad"),
      reprocessing: reprocessing(),
      advancedAt: new Date("2026-06-16T20:40:00.000Z"),
    });

    expect(result?.evaluation).toEqual(expect.objectContaining({ allowed: true, decision: "promoted" }));
    expect(result?.plan).toEqual(expect.objectContaining({
      stage: "broad",
      scope: "all_users",
      percentage: 100,
    }));
  });

  it("rejeita promocao quando gates ou reprocessamento indicam regressao", () => {
    const plan = createWhatsappPromotionPlan({ candidate: candidate() });
    advanceWhatsappPromotion({ planId: plan.id, actor: "system", targetStage: "shadow" });

    const result = advanceWhatsappPromotion({
      planId: plan.id,
      actor: "technical_reviewer",
      targetStage: "canary",
      qualityGate: gate("reject"),
      reprocessing: reprocessing({ decision: "reject", regressionCount: 1 }),
    });

    expect(result?.evaluation).toEqual(expect.objectContaining({ allowed: false, decision: "rejected" }));
    expect(result?.plan.stage).toBe("rejected");
    expect(result?.plan.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: "rejected", toStage: "rejected" }),
    ]));
  });

  it("bloqueia promocao quando sombra detecta piora", () => {
    const plan = createWhatsappPromotionPlan({ candidate: candidate() });
    advanceWhatsappPromotion({ planId: plan.id, actor: "system", targetStage: "shadow" });
    recordWhatsappShadowComparison({
      planId: plan.id,
      comparison: {
        messageId: "msg-2",
        intent: "nutrition_question",
        currentDecision: "answer_only",
        candidateDecision: "save_food",
        currentPersisted: false,
        candidatePersisted: true,
        currentConfidence: 0.86,
        candidateConfidence: 0.9,
        outcome: "candidate_worse",
        reason: "Candidata transformou pergunta em registro alimentar.",
      },
    });

    const readiness = evaluateWhatsappPromotionReadiness(plan.id, "canary");

    expect(readiness).toEqual(expect.objectContaining({
      allowed: false,
      decision: "review_required",
      reason: expect.stringContaining("sombra"),
    }));
  });

  it("executa rollback restaurando versao anterior", () => {
    const plan = createWhatsappPromotionPlan({ candidate: candidate() });
    advanceWhatsappPromotion({ planId: plan.id, actor: "system", targetStage: "shadow" });
    advanceWhatsappPromotion({ planId: plan.id, actor: "technical_reviewer", targetStage: "canary", qualityGate: gate("approve_canary"), reprocessing: reprocessing(), percentage: 5 });
    advanceWhatsappPromotion({ planId: plan.id, actor: "administrator", targetStage: "broad", qualityGate: gate("approve_broad"), reprocessing: reprocessing() });

    const rolledBack = rollbackWhatsappPromotion({
      planId: plan.id,
      actor: "technical_reviewer",
      reason: "Aumento de correcao posterior no canary expandido.",
      rolledBackAt: new Date("2026-06-16T21:00:00.000Z"),
    });

    expect(rolledBack).toEqual(expect.objectContaining({
      stage: "rolled_back",
      scope: "internal",
      percentage: 0,
      rollback: expect.objectContaining({ restoredVersion: "whatsapp-prompt/v1" }),
    }));
    expect(rolledBack?.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ decision: "rolled_back", fromStage: "broad", toStage: "rolled_back" }),
    ]));
  });
});
