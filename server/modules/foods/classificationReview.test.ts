import { describe, expect, it } from "vitest";

import {
  buildFoodClassificationReviewDecision,
  buildFoodClassificationReviewQueue,
  evaluateFoodClassificationForReview,
  summarizeFoodClassificationForReports,
  type FoodClassificationReviewFood,
} from "./classificationReview";

function food(overrides: Partial<FoodClassificationReviewFood> = {}): FoodClassificationReviewFood {
  return {
    id: 10,
    name: "Arroz branco cozido",
    ownerUserId: null,
    brandName: null,
    category: "Cereais",
    status: "active",
    source: {
      slug: "curadoria-br-inicial",
      name: "Curadoria interna",
      version: "2026-06",
      foodCode: "BR-COMMON-001",
    },
    caloriesKcalPer100g: 128,
    userSignals: {
      usageCount: 1,
      lastUsedAt: "2026-06-15T12:00:00.000Z",
    },
    classification: {
      foodGroup: "cereal",
      foodQuality: "in_natura_ou_minimamente_processado",
      processingLevel: "minimally_processed",
      flags: {
        isFruit: false,
        isVegetable: false,
        isUltraProcessed: false,
      },
      confidence: 0.91,
      origin: "curadoria-br-inicial",
      sourceVersion: "2026-06",
      status: "reviewed",
      reviewedAt: "2026-06-15T12:00:00.000Z",
      ruleVersion: "classification-v1",
    },
    ...overrides,
  };
}

describe("food classification review", () => {
  it("coloca alimento global novo sem revisao em pendencia", () => {
    const result = evaluateFoodClassificationForReview(food({
      classification: {
        foodGroup: "cereal",
        foodQuality: "in_natura_ou_minimamente_processado",
        processingLevel: "minimally_processed",
        flags: {
          isFruit: false,
          isVegetable: false,
          isUltraProcessed: false,
        },
        confidence: 0.88,
        origin: "curadoria-br-inicial",
        sourceVersion: "2026-06",
        ruleVersion: "classification-v1",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      foodId: 10,
      state: "pending",
      reviewStatus: "pending",
      reasons: expect.arrayContaining(["new_global_food"]),
      problematicFields: [],
    }));
  });

  it("identifica classificacao incompleta por campos minimos ausentes", () => {
    const result = evaluateFoodClassificationForReview(food({
      category: null,
      classification: {
        confidence: 0.82,
        origin: "classification-import",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      state: "unclassified",
      reasons: expect.arrayContaining([
        "missing_food_group",
        "missing_food_quality",
        "missing_processing_level",
        "missing_classification_flags",
      ]),
      problematicFields: expect.arrayContaining([
        "foodGroup",
        "foodQuality",
        "processingLevel",
        "flags",
      ]),
    }));
  });

  it("envia classificacao de baixa confianca para revisao com prioridade maior quando muito usada", () => {
    const result = evaluateFoodClassificationForReview(food({
      caloriesKcalPer100g: 520,
      userSignals: { usageCount: 15 },
      classification: {
        foodGroup: "doce",
        foodQuality: "ocasional",
        processingLevel: "ultra_processed",
        flags: { isUltraProcessed: true },
        confidence: 0.48,
        origin: "ai_classification",
        sourceVersion: "2026-06",
      },
    }));

    expect(result).toEqual(expect.objectContaining({
      state: "low_confidence",
      priority: "critical",
      reasons: expect.arrayContaining([
        "low_confidence_classification",
        "high_usage_food",
        "high_calorie_food",
      ]),
      problematicFields: expect.arrayContaining(["confidence"]),
    }));
  });

  it("diferencia classificado, estimado, pendente e nao classificado para relatorios", () => {
    const summary = summarizeFoodClassificationForReports([
      food(),
      food({
        id: 11,
        name: "Item estimado",
        classification: {
          foodGroup: "preparacao",
          foodQuality: "estimado",
          processingLevel: "unknown",
          flags: { isUltraProcessed: null },
          confidence: 0.76,
          origin: "documented_estimate_rule",
          reviewedAt: "2026-06-15T12:00:00.000Z",
          isEstimated: true,
        },
      }),
      food({
        id: 12,
        name: "Item pendente",
        classification: {
          foodGroup: "bebida",
          foodQuality: "neutro",
          processingLevel: "processed",
          flags: { isUltraProcessed: false },
          confidence: 0.83,
          origin: "curadoria-br-inicial",
        },
      }),
      food({
        id: 13,
        name: "Item sem classificacao",
        category: null,
        classification: null,
      }),
    ]);

    expect(summary).toEqual(expect.objectContaining({
      total: 4,
      classified: 1,
      estimated: 1,
      pending: 1,
      unclassified: 1,
    }));
  });

  it("marca reprocessamento quando fonte fica obsoleta ou nova regra foi aprovada", () => {
    const queue = buildFoodClassificationReviewQueue([
      food({
        id: 21,
        name: "Produto com fonte antiga",
        source: { slug: "tbca", name: "TBCA", version: "2024-01" },
        classification: {
          foodGroup: "laticinio",
          foodQuality: "bom",
          processingLevel: "processed",
          flags: { isUltraProcessed: false },
          confidence: 0.86,
          origin: "tbca",
          sourceVersion: "2024-01",
          reviewedAt: "2026-06-15T12:00:00.000Z",
          ruleVersion: "classification-v1",
        },
      }),
    ], {
      approvedSourceVersions: { tbca: "2026-01" },
      activeRuleVersion: "classification-v2",
    });

    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual(expect.objectContaining({
      reprocess: true,
      reasons: expect.arrayContaining(["obsolete_source", "new_rule_available"]),
      problematicFields: expect.arrayContaining(["sourceVersion", "ruleVersion"]),
    }));
  });

  it("bloqueia decisao de substituicao sem alimento destino", () => {
    expect(() => buildFoodClassificationReviewDecision({
      foodId: 10,
      status: "substituted",
      reviewerId: 7,
    })).toThrow("alimento substituto");
  });
});