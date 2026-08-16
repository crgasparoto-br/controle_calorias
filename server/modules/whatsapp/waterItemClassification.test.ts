import { describe, expect, it } from "vitest";

import { isPureWaterItem, resolveWaterVolumeMl, splitMealItemsForWaterHydration } from "./waterItemClassification";
import type { FoodClassificationEstimate, MealDraftItem } from "../../nutritionEngineTypes";

const plainWaterClassification: FoodClassificationEstimate = {
  processingLevel: "natural_or_minimally_processed",
  isFruit: false,
  isVegetable: false,
  fiberGrams: 0,
  isPlainWater: true,
};

const processedBeverageClassification: FoodClassificationEstimate = {
  processingLevel: "processed",
  isFruit: false,
  isVegetable: false,
  fiberGrams: 0,
  isPlainWater: false,
};

const naturalNonPlainWaterClassification: FoodClassificationEstimate = {
  processingLevel: "natural_or_minimally_processed",
  isFruit: false,
  isVegetable: false,
  fiberGrams: 0,
  isPlainWater: false,
};

function waterItem(overrides: Partial<MealDraftItem> = {}): MealDraftItem {
  return {
    foodName: "Água Mineral",
    canonicalName: "Água Mineral",
    quantity: 500,
    unit: "ml",
    portionText: "500 ml",
    servings: 1,
    estimatedGrams: 500,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.9,
    source: "catalog",
    classification: plainWaterClassification,
    ...overrides,
  };
}

describe("waterItemClassification", () => {
  it("reconhece marca e volume embutidos no nome com evidência semântica de água pura", () => {
    expect(isPureWaterItem({
      foodName: "Água Mineral com Gás Crystal 500ml",
      canonicalName: "Água Mineral com Gás Crystal 500 ml",
      classification: plainWaterClassification,
    })).toBe(true);

    expect(isPureWaterItem({
      foodName: "Água Mineral Serra Clara 500 ml",
      canonicalName: "Água Mineral Serra Clara",
      classification: plainWaterClassification,
    })).toBe(true);

    expect(isPureWaterItem({
      foodName: "Água Mineral Fonte e Vida 500 ml",
      canonicalName: "Água Mineral Fonte e Vida",
      classification: plainWaterClassification,
    })).toBe(true);
  });

  it("mantém bebidas não puras fora da hidratação mesmo quando outro nome parece água mineral", () => {
    expect(isPureWaterItem({
      foodName: "Água Mineral Marca X",
      canonicalName: "Água Tônica Marca X",
      classification: processedBeverageClassification,
    })).toBe(false);
    expect(isPureWaterItem({
      foodName: "Água de Coco",
      canonicalName: "Água de Coco",
      classification: plainWaterClassification,
    })).toBe(false);
    expect(isPureWaterItem({
      foodName: "Água Sabor Limão",
      canonicalName: "Água Saborizada",
      classification: processedBeverageClassification,
    })).toBe(false);
  });

  it("falha fechado para desconhecidos sem evidência positiva e para composições explícitas", () => {
    expect(isPureWaterItem({
      foodName: "Água Mineral Produto Desconhecido",
      canonicalName: "Água Mineral Produto Desconhecido",
    })).toBe(false);
    expect(isPureWaterItem({
      foodName: "Água Mineral com Gás e Vodka 500 ml",
      canonicalName: "Água Mineral com Gás e Vodka",
      classification: plainWaterClassification,
    })).toBe(false);
    expect(isPureWaterItem({
      foodName: "Água Mineral com Gás Limão 500 ml",
      canonicalName: "Água Mineral com Gás Limão",
      classification: processedBeverageClassification,
    })).toBe(false);
    expect(isPureWaterItem({
      foodName: "Água Mineral Hibisco 500 ml",
      canonicalName: "Água Mineral Hibisco",
      classification: processedBeverageClassification,
    })).toBe(false);
    expect(isPureWaterItem({
      foodName: "Água Mineral Limão 500 ml",
      canonicalName: "Água Mineral Limão",
      classification: naturalNonPlainWaterClassification,
    })).toBe(false);
    expect(isPureWaterItem({
      foodName: "Água Mineral Hortelã 500 ml",
      canonicalName: "Água Mineral Hortelã",
      classification: naturalNonPlainWaterClassification,
    })).toBe(false);
  });

  it("não usa nível NOVA como substituto da evidência de água pura", () => {
    expect(isPureWaterItem({
      foodName: "Água Mineral Marca Inédita 500 ml",
      canonicalName: "Água Mineral Marca Inédita",
      classification: {
        processingLevel: "natural_or_minimally_processed",
        isFruit: false,
        isVegetable: false,
        fiberGrams: 0,
      },
    })).toBe(false);
  });

  it("não interpreta token desconhecido no meio da gramática de água como marca embutida", () => {
    expect(isPureWaterItem({
      foodName: "Água Crystal Mineral 500 ml",
      canonicalName: "Água Crystal Mineral",
      classification: plainWaterClassification,
    })).toBe(false);
  });

  it("resolve o volume quando ele existe somente no nome aceito", () => {
    const split = splitMealItemsForWaterHydration([
      waterItem({
        foodName: "Água Mineral com Gás Crystal 500 ml",
        canonicalName: "Água Mineral com Gás Crystal",
        brand: undefined,
        quantity: undefined as never,
        unit: undefined as never,
        portionText: "",
      }),
    ]);

    expect(split.waterVolumeMl).toBe(500);
    expect(split.remainingItems).toEqual([]);
    expect(split.hasWaterWithoutVolume).toBe(false);
  });

  it("falha fechado quando os nomes carregam volumes conflitantes", () => {
    expect(resolveWaterVolumeMl({
      foodName: "Água Mineral 500 ml",
      canonicalName: "Água Mineral 1 l",
    })).toBeNull();
  });

  it("prioriza água pura sobre macros nutricionais já preenchidos", () => {
    const split = splitMealItemsForWaterHydration([
      waterItem({
        foodName: "Água Mineral com Gás Serra Clara 500 ml",
        canonicalName: "Água Mineral com Gás Serra Clara",
        calories: 750,
        protein: 30,
        carbs: 75,
        fat: 25,
      }),
    ]);

    expect(split.waterVolumeMl).toBe(500);
    expect(split.remainingItems).toEqual([]);
    expect(split.hasWaterWithoutVolume).toBe(false);
  });
});