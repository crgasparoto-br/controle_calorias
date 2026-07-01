import { describe, expect, it } from "vitest";
import { __foodQualityTesting } from "./service";

const { calculateQualityIndicators, createFoodLookup } = __foodQualityTesting;

type FoodFixture = {
  id: number;
  name: string;
  brandName: string | null;
  servingSize: number;
  servingUnit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  isFruit: boolean;
  isVegetable: boolean;
  isUltraProcessed: boolean;
  source: string;
  foodType: "generic" | "branded";
  isUserCreated: boolean;
  createdByUserId: number | null;
  isFavorite: boolean;
  lastUsedAt: number | null;
};

function food(overrides: Partial<FoodFixture> = {}): FoodFixture {
  return {
    id: 1,
    name: "Banana",
    brandName: null,
    servingSize: 100,
    servingUnit: "g",
    calories: 90,
    protein: 1,
    carbs: 22,
    fat: 0,
    fiber: 2,
    isFruit: false,
    isVegetable: false,
    isUltraProcessed: false,
    source: "test",
    foodType: "generic",
    isUserCreated: false,
    createdByUserId: null,
    isFavorite: false,
    lastUsedAt: null,
    ...overrides,
  };
}

function mealItem(overrides: Record<string, unknown> = {}) {
  return {
    foodName: "item de teste",
    canonicalName: "item de teste",
    portionText: "100 g",
    quantity: 100,
    unit: "g",
    servings: 1,
    estimatedGrams: 100,
    calories: 100,
    protein: 1,
    carbs: 20,
    fat: 1,
    confidence: 0.9,
    source: "catalog" as const,
    ...overrides,
  };
}

function meal(items: unknown[]) {
  return [
    {
      id: 1,
      userId: 1,
      source: "web",
      mealLabel: "lanche",
      status: "confirmed",
      occurredAt: new Date("2026-06-01T12:00:00.000Z").getTime(),
      sourceText: "",
      confidence: 0.9,
      items,
      media: [],
      createdAt: Date.now(),
    },
  ] as never;
}

describe("food quality report lookup", () => {
  it("classifica por foodCatalogId antes do texto", () => {
    const lookup = createFoodLookup([
      food({ id: 10, name: "Banana", isFruit: true }),
    ]);
    const quality = calculateQualityIndicators(
      meal([
        mealItem({
          foodCatalogId: 10,
          foodName: "texto divergente",
          canonicalName: "texto divergente",
          portionText: "porção sem alias",
        }),
      ]),
      0,
      lookup,
    );

    expect(quality.fruitServings).toBe(1);
    expect(quality.foodQualityItems[0]).toMatchObject({
      isClassified: true,
      isFruit: true,
    });
  });

  it("usa fallback textual quando o foodCatalogId não resolve", () => {
    const lookup = createFoodLookup([
      food({ id: 20, name: "Aveia", fiber: 8 }),
    ]);
    const quality = calculateQualityIndicators(
      meal([
        mealItem({
          foodCatalogId: 999,
          foodName: "Aveia",
          canonicalName: "Aveia",
          estimatedGrams: 50,
        }),
      ]),
      0,
      lookup,
    );

    expect(quality.fiberGrams).toBe(4);
    expect(quality.foodQualityItems[0]).toMatchObject({ isClassified: true });
  });

  it("mantém item desconhecido como não classificado com diagnóstico mínimo", () => {
    const lookup = createFoodLookup([
      food({ id: 30, name: "Maçã", isFruit: true }),
    ]);
    const quality = calculateQualityIndicators(
      meal([
        mealItem({
          foodName: "produto sem cadastro",
          canonicalName: "produto sem cadastro",
          portionText: "1 unidade",
        }),
      ]),
      0,
      lookup,
    );

    expect(quality.foodQualityItems[0]).toMatchObject({
      calories: 100,
      foodName: "produto sem cadastro",
      canonicalName: "produto sem cadastro",
      portionText: "1 unidade",
      isClassified: false,
      unclassifiedReason: "missing_catalog_id",
    });
  });
});
