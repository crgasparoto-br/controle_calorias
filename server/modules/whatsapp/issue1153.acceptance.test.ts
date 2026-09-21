import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappMessageHistoryForTests,
  hydrateWhatsappMessageHistory,
  loadPersistedWhatsappMessageHistory,
  recordWhatsappMessageHistory,
} from "./messageHistory";
import { __resetWhatsappLearningArtifactPersistenceForTests } from "./learningArtifactPersistence";
import {
  aggregateWhatsappLearningEvidence,
  __resetWhatsappLearningGovernanceForTests,
  hydrateWhatsappLearningGovernance,
  listWhatsappLearningCandidates,
  recordWhatsappLearningCandidate,
  recordWhatsappLearningCandidateDurably,
  evaluateWhatsappLearningPromotion,
} from "./learningGovernance";
import {
  buildWhatsappQualityMetricsReport,
  buildWhatsappQualityMetricsReportDurably,
  __resetWhatsappQualityMetricsForTests,
  loadPersistedWhatsappQualityMetricsReports,
} from "./qualityMetrics";

describe("issue #1153 - auditable learning acceptance", () => {
  beforeEach(() => {
    __resetWhatsappMessageHistoryForTests();
    __resetWhatsappLearningArtifactPersistenceForTests();
    __resetWhatsappLearningGovernanceForTests();
    __resetWhatsappQualityMetricsForTests();
  });

  it("keeps item identity, evidence origin and fallback safety separate", () => {
    const entry = recordWhatsappMessageHistory({
      userId: 42,
      messageText: "adicione meu iogurte integral",
      intent: {
        intent: "add_foods_to_meal",
        confidence: 0.91,
        requiresConfirmation: false,
        possibleIntents: ["add_foods_to_meal"],
        items: [
          {
            foodName: "iogurte",
            brand: "Marca A",
            variant: "integral",
            quantity: 1,
            unit: "pote",
            preparation: null,
          },
        ],
        date: null,
        meal: null,
        sourceFood: null,
        targetFood: null,
        calculation: null,
      },
      inputType: "image_caption",
      fallbackSafe: false,
      replyKind: "fallback",
      action: "safe_fallback",
      status: "success",
      nutritionSource: {
        sourceType: "ai_estimate",
        estimated: true,
        confidence: 0.4,
      },
    });

    expect(entry.itemObservations).toEqual([
      expect.objectContaining({
        brand: "Marca A",
        variant: "integral",
        quantity: 1,
        fallback: true,
        fallbackSafe: false,
        brandEvidence: "ocr",
      }),
    ]);

    const report = buildWhatsappQualityMetricsReport({ entries: [entry] });
    expect(report.totals).toEqual(
      expect.objectContaining({
        fallbackRate: 1,
        fallbackSafetyDenominator: 1,
        fallbackSafeCount: 0,
        fallbackSafeRate: 0,
      })
    );
  });

  it("does not count repeated confirmations from one user as multi-user evidence", () => {
    expect(
      aggregateWhatsappLearningEvidence([
        { userId: 42, identityKey: "iogurte|marca a" },
        { userId: 42, identityKey: "iogurte|marca a" },
      ])
    ).toMatchObject({
      frequency: 2,
      distinctUserCount: 1,
      conflictDetected: false,
    });

    const candidate = recordWhatsappLearningCandidate({
      kind: "global_rule",
      action: "propose_global_rule",
      scope: "global",
      origin: "feedback_loop",
      title: "Regra de identidade comercial",
      rationale: "Sinal repetido precisa de evidência multiusuário.",
      evidence: [
        {
          source: "feedback",
          reference: "feedback-1",
          summary: "same identity",
          userIdHash: "u42",
        },
      ],
      expectedImpact: "reduzir ambiguidades",
      metric: "brand_variant_accuracy",
      payload: {
        requiresMultiUserEvidence: true,
        sourceUserIds: [42, 42],
        replayDecision: "review",
        qualityGateDecision: "review",
      },
    });
    expect(
      evaluateWhatsappLearningPromotion({ candidateId: candidate.id }).allowed
    ).toBe(false);
  });

  it("rebuilds governed candidates and metric reports from durable artifacts", async () => {
    const created = await recordWhatsappLearningCandidateDurably({
      kind: "hypothesis",
      action: "group_recurring_error",
      scope: "global",
      origin: "offline-replay",
      title: "Erro recorrente",
      rationale: "Repetição observada em replay.",
      evidence: [
        {
          source: "offline_replay",
          reference: "replay-1153",
          summary: "caso repetido",
        },
      ],
      expectedImpact: "gerar fixture de regressão",
      payload: {},
    });
    expect(created.persisted).toBe(true);
    __resetWhatsappLearningGovernanceForTests();
    await expect(hydrateWhatsappLearningGovernance()).resolves.toMatchObject({
      persisted: true,
      candidates: 1,
      auditEvents: 1,
    });
    expect(listWhatsappLearningCandidates()).toEqual([
      expect.objectContaining({
        id: created.candidate.id,
        title: "Erro recorrente",
      }),
    ]);

    const history = recordWhatsappMessageHistory({
      userId: 42,
      messageText: "arroz",
      intent: null,
      action: "save_food",
      replyKind: "executed",
      status: "success",
    });
    const built = await buildWhatsappQualityMetricsReportDurably({
      entries: [history],
    });
    expect(built.persisted).toBe(true);
    __resetWhatsappQualityMetricsForTests();
    await expect(loadPersistedWhatsappQualityMetricsReports()).resolves.toEqual(
      [
        expect.objectContaining({
          id: built.report.id,
          totals: expect.objectContaining({ messages: 1 }),
        }),
      ]
    );
  });
});
