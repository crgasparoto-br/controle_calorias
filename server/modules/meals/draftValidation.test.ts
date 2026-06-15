import { describe, expect, it } from "vitest";
import type { MealDraftItem } from "../../nutritionEngine";
import { validateMealDraftForPersistence } from "./draftValidation";

function buildItem(overrides: Partial<MealDraftItem> = {}): MealDraftItem {
  return {
    foodName: "Coca-Cola zero lata",
    canonicalName: "Coca-Cola zero lata",
    quantity: 1,
    unit: "lata",
    portionText: "1 lata",
    servings: 1,
    estimatedGrams: 350,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.82,
    source: "catalog",
    nutritionSource: {
      candidate: {
        id: "coca-cola-zero-lata",
        name: "Coca-Cola zero lata",
        brandName: "Coca-Cola",
        sourceType: "curated_catalog",
      },
      quality: "exact",
      confidence: 0.86,
      isEstimate: false,
      reviewRequired: false,
      reasons: ["exact_brand_variation_match"],
      source: {
        type: "curated_catalog",
        name: "Catálogo interno",
        version: "static-reference",
        reviewedAt: null,
      },
      selectedAt: "2026-06-15T12:00:00.000Z",
    },
    ...overrides,
  };
}

describe("validateMealDraftForPersistence", () => {
  it("aceita item estruturado com fonte nutricional rastreavel mesmo quando macros sao zero", () => {
    const validation = validateMealDraftForPersistence({ items: [buildItem()] });

    expect(validation).toEqual({
      valid: true,
      issues: [],
    });
  });

  it("aceita estimativa quando esta marcada para revisao", () => {
    const validation = validateMealDraftForPersistence({
      items: [buildItem({
        source: "heuristic",
        calories: 150,
        carbs: 15,
        nutritionSource: {
          candidate: {
            id: "generic_estimate:item",
            name: "Item estimado",
            sourceType: "generic_estimate",
          },
          quality: "estimated",
          confidence: 0.55,
          isEstimate: true,
          reviewRequired: true,
          reasons: ["estimated_fallback_used"],
          source: {
            type: "generic_estimate",
            name: "Estimativa por regra interna",
            version: null,
            reviewedAt: null,
          },
          selectedAt: "2026-06-15T12:00:00.000Z",
        },
      })],
    });

    expect(validation.valid).toBe(true);
  });

  it("bloqueia item sem fonte nutricional", () => {
    const validation = validateMealDraftForPersistence({
      items: [{
        ...buildItem(),
        nutritionSource: undefined,
      } as unknown as MealDraftItem],
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_nutrition_source", itemIndex: 0 }),
    ]));
  });

  it("bloqueia baixa confianca de item", () => {
    const validation = validateMealDraftForPersistence({
      items: [buildItem({ confidence: 0.2 })],
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "low_item_confidence", itemIndex: 0 }),
    ]));
  });

  it("bloqueia estimativa sem revisao marcada", () => {
    const validation = validateMealDraftForPersistence({
      items: [buildItem({
        nutritionSource: {
          ...buildItem().nutritionSource!,
          quality: "estimated",
          isEstimate: true,
          reviewRequired: false,
        },
      })],
    });

    expect(validation.valid).toBe(false);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "estimated_source_without_review", itemIndex: 0 }),
    ]));
  });
});
