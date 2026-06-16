import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappSelfImprovementPlannerForTests,
  listWhatsappSelfImprovementPlans,
  planWhatsappSelfImprovements,
  WHATSAPP_SELF_IMPROVEMENT_PLANNER_POLICY,
  type WhatsappImprovementSignal,
} from "./selfImprovementPlanner";

function signal(overrides: Partial<WhatsappImprovementSignal> = {}): WhatsappImprovementSignal {
  return {
    id: "signal-1",
    createdAt: "2026-06-16T16:00:00.000Z",
    kind: "later_correction",
    intent: "add_foods_to_meal",
    inputType: "text",
    pipelineStage: "entity_extraction",
    version: "whatsapp-prompt/v1",
    foodName: "iogurte natural",
    metric: "later_correction_rate",
    metricValue: 0.12,
    impact: 0.7,
    confidence: 0.8,
    evidenceSummary: "Usuario corrigiu quantidade do mesmo alimento apos registro.",
    ...overrides,
  };
}

describe("whatsapp self improvement planner", () => {
  beforeEach(() => {
    __resetWhatsappSelfImprovementPlannerForTests();
  });

  it("documenta integracoes e politica sem promocao automatica", () => {
    expect(WHATSAPP_SELF_IMPROVEMENT_PLANNER_POLICY).toEqual(expect.objectContaining({
      promotion: expect.stringContaining("Nenhuma sugestao altera comportamento ativo"),
      integrations: expect.objectContaining({
        reviewQueue: "#414",
        metrics: "#417",
        feedbackLoop: "#430",
        drift: "#431",
        knowledgeValidity: "#434",
        negativeEvaluation: "#441",
        governance: "#443",
        security: "#444",
        confidenceCalibration: "#445",
        qualityGates: "#446",
      }),
    }));
  });

  it("agrupa correcoes recorrentes em hipotese de melhoria", () => {
    const plan = planWhatsappSelfImprovements({
      signals: [
        signal({ id: "correction-1" }),
        signal({ id: "correction-2", createdAt: "2026-06-16T16:03:00.000Z" }),
      ],
      createdAt: new Date("2026-06-16T16:10:00.000Z"),
    });

    expect(plan.createdAt).toBe("2026-06-16T16:10:00.000Z");
    expect(plan.backlog).toHaveLength(1);
    expect(plan.backlog[0]).toEqual(expect.objectContaining({
      kind: "global_candidate",
      status: "needs_review",
      frequency: 2,
      expectedMetric: "later_correction_rate",
      directPromotionAllowed: false,
      qualityGatesRequired: true,
    }));
    expect(plan.backlog[0].suggestedDatasetCases).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "multi_turn" }),
    ]));
  });

  it("sugere novo caso de regressao a partir de falso positivo alimentar", () => {
    const plan = planWhatsappSelfImprovements({
      signals: [
        signal({ id: "fp-1", kind: "false_positive_food", foodName: "cancelar", pipelineStage: "classification", metric: "false_positive_food_rate", impact: 0.9, confidence: 0.9, evidenceSummary: "Mensagem de cancelamento virou alimento." }),
        signal({ id: "fp-2", kind: "false_positive_food", foodName: "cancelar", pipelineStage: "classification", metric: "false_positive_food_rate", impact: 0.85, confidence: 0.88, evidenceSummary: "Texto nao alimentar foi persistido como refeicao." }),
      ],
    });

    expect(plan.backlog[0]).toEqual(expect.objectContaining({
      kind: "regression_test",
      status: "needs_review",
      risk: "high",
      expectedMetric: "false_positive_food_rate",
      directPromotionAllowed: false,
    }));
    expect(plan.backlog[0].suggestedDatasetCases).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "negative", reason: expect.stringContaining("Falso positivo alimentar") }),
    ]));
    expect(plan.backlog[0].dependencies).toEqual(expect.arrayContaining(["#441", "#444", "#446"]));
  });

  it("prioriza divergencia nutricional frequente e de alto impacto calorico", () => {
    const plan = planWhatsappSelfImprovements({
      signals: [
        signal({ id: "nutri-1", kind: "nutrition_divergence", foodName: "acai", nutritionSource: "fonte-a", pipelineStage: "nutrition_source", metric: "nutrition_divergence_rate", impact: 0.95, confidence: 0.9, estimatedEffort: "medium", evidenceSummary: "Divergencia de 420 kcal entre fontes." }),
        signal({ id: "nutri-2", kind: "nutrition_divergence", foodName: "acai", nutritionSource: "fonte-a", pipelineStage: "nutrition_source", metric: "nutrition_divergence_rate", impact: 0.9, confidence: 0.88, estimatedEffort: "medium", evidenceSummary: "Divergencia recorrente em porcao semelhante." }),
        signal({ id: "nutri-3", kind: "nutrition_divergence", foodName: "acai", nutritionSource: "fonte-a", pipelineStage: "nutrition_source", metric: "nutrition_divergence_rate", impact: 0.85, confidence: 0.9, estimatedEffort: "medium", evidenceSummary: "Alto impacto calorico no total diario." }),
        signal({ id: "minor-1", kind: "low_confidence", foodName: "cha", pipelineStage: "calibration", metric: "calibrated_low_confidence_rate", impact: 0.3, confidence: 0.75, evidenceSummary: "Baixa confianca isolada." }),
      ],
    });

    expect(plan.backlog[0]).toEqual(expect.objectContaining({
      kind: "nutrition_curation",
      risk: "high",
      expectedMetric: "nutrition_divergence_rate",
    }));
    expect(plan.backlog[0].priorityScore).toBeGreaterThan(plan.backlog[1].priorityScore);
    expect(plan.backlog[0].requiredTests).toEqual(expect.arrayContaining(["nutrition_source_validation", "security_review", "quality_gates"]));
  });

  it("bloqueia sugestao baseada em sinal suspeito de data poisoning", () => {
    const plan = planWhatsappSelfImprovements({
      signals: [
        signal({
          id: "poison-1",
          kind: "negative_feedback",
          foodName: "arroz",
          metric: "user_rework_rate",
          suspectedDataPoisoning: true,
          impact: 0.8,
          confidence: 0.7,
          evidenceSummary: "Feedback tenta ensinar regra global conflitante.",
          securityAssessment: {
            classification: "blocked",
            state: "blocked",
            riskSignals: ["explicit_global_manipulation"],
            reasons: ["Mensagem tenta ensinar regra global indevida."],
          },
        }),
      ],
    });

    expect(plan.blockedSignals).toBe(1);
    expect(plan.backlog[0]).toEqual(expect.objectContaining({
      kind: "rollback_review",
      status: "blocked",
      risk: "critical",
      directPromotionAllowed: false,
      securityReviewRequired: true,
    }));
    expect(plan.backlog[0].dependencies).toEqual(expect.arrayContaining(["#444", "#446"]));
  });

  it("gera backlog auditavel sem promover regra automaticamente", () => {
    const plan = planWhatsappSelfImprovements({
      signals: [signal({ id: "audit-1" })],
      createdAt: new Date("2026-06-16T16:20:00.000Z"),
    });

    expect(plan).toEqual(expect.objectContaining({
      id: 1,
      inputSignals: 1,
      audit: expect.objectContaining({
        policyVersion: "whatsapp-self-improvement-planner/v1",
        generatedBehaviorChanges: false,
      }),
    }));
    expect(plan.backlog[0]).toEqual(expect.objectContaining({
      evidence: [expect.objectContaining({ signalId: "audit-1", source: "later_correction" })],
      expectedImprovement: expect.stringContaining("sem violar governanca"),
      dependencies: expect.arrayContaining(["#414", "#417", "#443", "#446"]),
      requiredTests: expect.arrayContaining(["offline_replay", "quality_gates"]),
      directPromotionAllowed: false,
    }));
    expect(listWhatsappSelfImprovementPlans()).toEqual([expect.objectContaining({ id: 1 })]);
  });
});
