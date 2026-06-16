import { describe, expect, it } from "vitest";

import {
  buildKnowledgeReviewSignal,
  buildKnowledgeUseAuditSnapshot,
  canUseKnowledgeAsActive,
  createReviewableKnowledgeItem,
  evaluateKnowledgeReviewNeed,
  replaceReviewableKnowledgeItem,
  selectActiveKnowledgeOrFallback,
} from "./knowledgeReview";

function item(overrides: Partial<ReturnType<typeof createReviewableKnowledgeItem>> = {}) {
  return createReviewableKnowledgeItem({
    id: "rule:portion:v1",
    type: "interpretation_heuristic",
    key: "portion-text-normalization",
    scope: "global",
    origin: "curadoria-interna",
    version: "v1",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastReviewedAt: "2026-05-01T00:00:00.000Z",
    approvedBy: "curator:1",
    confidence: 0.86,
    appliesTo: ["whatsapp", "nutrition-estimate"],
    reason: "Normaliza medidas caseiras comuns.",
    ...overrides,
  });
}

describe("knowledge review", () => {
  it("registra item revisavel com metadados obrigatorios", () => {
    expect(item()).toEqual(expect.objectContaining({
      id: "rule:portion:v1",
      type: "interpretation_heuristic",
      status: "active",
      scope: "global",
      origin: "curadoria-interna",
      version: "v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      lastReviewedAt: "2026-05-01T00:00:00.000Z",
      approvedBy: "curator:1",
      confidence: 0.86,
      appliesTo: ["whatsapp", "nutrition-estimate"],
      reviewVersion: "knowledge-review-v1",
    }));
  });

  it("marca needs_review por idade ou baixa confianca", () => {
    const assessment = evaluateKnowledgeReviewNeed({
      item: item({ confidence: 0.61, lastReviewedAt: "2025-01-01T00:00:00.000Z" }),
      now: "2026-06-16T00:00:00.000Z",
      policy: { maxAgeDays: 180, minimumConfidence: 0.72 },
    });

    expect(assessment).toEqual(expect.objectContaining({
      status: "needs_review",
      mustBlockActiveUse: false,
      canUseWithWarning: true,
      confidence: 0.46,
      reasons: expect.arrayContaining(["age_expired", "low_confidence"]),
    }));
  });

  it("substitui uma regra mantendo historico da versao anterior", () => {
    const current = item();
    const replacement = item({
      id: "rule:portion:v2",
      version: "v2",
      createdAt: "2026-06-16T00:00:00.000Z",
      lastReviewedAt: null,
      approvedBy: null,
    });

    const result = replaceReviewableKnowledgeItem({
      current,
      replacement,
      decidedAt: "2026-06-16T12:00:00.000Z",
      decidedBy: "curator:2",
      reason: "Nova regra validada com menor erro.",
    });

    expect(result.previous).toEqual(expect.objectContaining({
      id: "rule:portion:v1",
      status: "replaced",
      replacedById: "rule:portion:v2",
    }));
    expect(result.next).toEqual(expect.objectContaining({
      id: "rule:portion:v2",
      status: "active",
      replacesId: "rule:portion:v1",
      approvedBy: "curator:2",
      lastReviewedAt: "2026-06-16T12:00:00.000Z",
    }));
    expect(result.decision).toEqual(expect.objectContaining({
      itemId: "rule:portion:v1",
      status: "replaced",
      replacementId: "rule:portion:v2",
    }));
  });

  it("impede uso ativo de item desativado, obsoleto ou substituido", () => {
    expect(canUseKnowledgeAsActive(item({ status: "disabled" }))).toBe(false);
    expect(canUseKnowledgeAsActive(item({ status: "deprecated" }))).toBe(false);
    expect(canUseKnowledgeAsActive(item({ status: "replaced" }))).toBe(false);
  });

  it("marca item por sinal de metrica, drift ou divergencia nutricional", () => {
    const assessment = evaluateKnowledgeReviewNeed({
      item: item(),
      now: "2026-06-16T00:00:00.000Z",
      signals: [
        buildKnowledgeReviewSignal({
          type: "nutrition_divergence",
          reason: "estimate_divergence",
          severity: "high",
          observedAt: "2026-06-15T00:00:00.000Z",
          detail: "Erro de calorias acima do limite para laticinios.",
          metricName: "averageCaloriesRelativeError",
          value: 0.62,
          threshold: 0.25,
        }),
      ],
    });

    expect(assessment).toEqual(expect.objectContaining({
      status: "needs_review",
      mustBlockActiveUse: false,
      reasons: expect.arrayContaining(["estimate_divergence"]),
      signals: expect.arrayContaining([
        expect.objectContaining({ type: "nutrition_divergence", severity: "high" }),
      ]),
    }));
  });

  it("usa fallback quando a fonte ativa foi desativada e nao ha substituta confiavel", () => {
    expect(selectActiveKnowledgeOrFallback({
      candidates: [item({ status: "disabled" })],
      now: "2026-06-16T00:00:00.000Z",
    })).toEqual(expect.objectContaining({
      selected: null,
      fallbackUsed: true,
      reason: "no_active_reviewable_knowledge_available",
    }));
  });

  it("mantem auditoria de decisao antiga usando versao ja substituida", () => {
    const snapshot = buildKnowledgeUseAuditSnapshot(item({
      status: "replaced",
      replacedById: "rule:portion:v2",
    }));

    expect(snapshot).toEqual({
      itemId: "rule:portion:v1",
      type: "interpretation_heuristic",
      key: "portion-text-normalization",
      origin: "curadoria-interna",
      version: "v1",
      statusAtUse: "replaced",
      confidenceAtUse: 0.86,
      reviewedAtUse: "2026-05-01T00:00:00.000Z",
      replacedByIdAtUse: "rule:portion:v2",
      reviewVersion: "knowledge-review-v1",
    });
  });
});