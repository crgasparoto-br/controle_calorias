import { describe, expect, it } from "vitest";
import { applyOnlineNutritionSourcesToMealItems } from "./nutritionOnlineSourceIntegration";
import type { MealDraftItem } from "./nutritionEngine";
import type { OnlineNutritionSourceCandidate } from "./nutritionOnlineSource";

const baseItem: MealDraftItem = {
  foodName: "Coca-Cola zero lata",
  canonicalName: "Refrigerante cola zero",
  quantity: 2,
  unit: "lata",
  portionText: "2 lata",
  servings: 2,
  estimatedGrams: 700,
  calories: 6,
  protein: 0,
  carbs: 1.2,
  fat: 0,
  confidence: 0.58,
  source: "heuristic",
};

const manufacturerCandidate: OnlineNutritionSourceCandidate = {
  id: "coca-zero-manufacturer-label",
  name: "Coca-Cola zero lata 350 ml",
  brandName: "Coca-Cola",
  variation: "zero",
  originType: "manufacturer",
  sourceName: "Coca-Cola Brasil",
  sourceUrl: "https://www.coca-cola.com/br/pt/about-us/faq/coca-cola-zero",
  sourceVersion: "2026-06",
  queriedAt: "2026-06-15T12:00:00.000Z",
  confidence: 0.97,
  serving: {
    quantity: 1,
    unit: "lata",
    text: "1 lata (350 ml)",
  },
  nutritionPerServing: {
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  },
  aliases: ["coca zero lata", "coca-cola zero"],
};

const retailerCandidate: OnlineNutritionSourceCandidate = {
  ...manufacturerCandidate,
  id: "coca-zero-retailer-label",
  originType: "trusted_retailer",
  sourceName: "Varejo com tabela nutricional",
  sourceUrl: "https://www.example.com/produtos/coca-zero-lata",
  confidence: 0.82,
};

const traditionalCandidate: OnlineNutritionSourceCandidate = {
  ...manufacturerCandidate,
  id: "coca-tradicional-manufacturer-label",
  name: "Coca-Cola tradicional lata 350 ml",
  variation: "tradicional",
  aliases: ["coca-cola tradicional", "coca lata"],
  nutritionPerServing: {
    calories: 149,
    protein: 0,
    carbs: 37,
    fat: 0,
  },
};

describe("applyOnlineNutritionSourcesToMealItems", () => {
  it("aplica fonte online aceita e recalcula macros pela quantidade do item", () => {
    const [item] = applyOnlineNutritionSourcesToMealItems([baseItem], [manufacturerCandidate]);

    expect(item).toEqual(expect.objectContaining({
      canonicalName: "Coca-Cola zero lata 350 ml",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0.97,
      source: "catalog",
      nutritionSource: expect.objectContaining({
        selectedAt: "2026-06-15T12:00:00.000Z",
        quality: "exact",
        reviewRequired: false,
        source: expect.objectContaining({
          type: "manufacturer_label",
          name: "Coca-Cola Brasil",
          version: "2026-06",
        }),
      }),
    }));
  });

  it("nao aplica varejo confiavel automaticamente porque requer revisao", () => {
    const [item] = applyOnlineNutritionSourcesToMealItems([baseItem], [retailerCandidate]);

    expect(item).toBe(baseItem);
  });

  it("nao aplica candidato com variacao critica conflitante", () => {
    const [item] = applyOnlineNutritionSourcesToMealItems([baseItem], [traditionalCandidate]);

    expect(item).toBe(baseItem);
  });

  it("nao aplica candidato quando a porcao nao permite conversao segura", () => {
    const [item] = applyOnlineNutritionSourcesToMealItems([
      {
        ...baseItem,
        quantity: 1,
        unit: "copo",
        portionText: "1 copo",
      },
    ], [manufacturerCandidate]);

    expect(item).toEqual(expect.objectContaining({
      canonicalName: "Refrigerante cola zero",
      source: "heuristic",
      calories: 6,
    }));
  });

  it("mantem itens sem candidatos online", () => {
    expect(applyOnlineNutritionSourcesToMealItems([baseItem])).toEqual([baseItem]);
  });
});
