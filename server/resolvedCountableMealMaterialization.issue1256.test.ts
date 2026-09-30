import { describe, expect, it } from "vitest";
import { findCountableNutritionReference } from "./foodItemResolution";
import { processMealInputWithPartialFailures } from "./partialMealProcessing";
import { materializeResolvedCountableMeal } from "./resolvedCommercialMealMaterialization";
import { scaleMealItem } from "./modules/whatsapp/intent/mealItemHelpers";
import type { CountableFoodResolvedMeasure } from "./countableFoodQuantity";

const PLACEHOLDER_PER_100G = {
  calories: 150,
  protein: 6,
  carbs: 15,
  fat: 5,
};

function resolvedMeasure(
  segment: string,
  foodName: string,
  grams: number,
): CountableFoodResolvedMeasure {
  return {
    segmentIndex: 0,
    request: {
      segment,
      foodName,
      brand: null,
      count: 1,
      requestedUnit: "un",
    },
    resolution: {
      kind: "canonical_portion",
      grams,
    },
  };
}

describe("issue #1256 — materialização canônica preserva nutrição contável", () => {
  it("leva a refeição multi-item até antes da mutação sem degradar para 150/6/15/5", async () => {
    const inputs = [
      ["1 tapioca", "tapioca", 50],
      ["1 ovo frito", "ovo frito", 50],
      ["1 requeijão", "requeijão", 66],
      ["1 melão", "melão", 278],
      ["1 banana", "banana", 80],
    ] as const;
    const registrationText = inputs
      .map(([, foodName, grams]) => `${grams} g de ${foodName}`)
      .join("\n");
    const resolvedSegments = inputs.map(([segment, foodName, grams], segmentIndex) => {
      const resolved = { ...resolvedMeasure(segment, foodName, grams), segmentIndex };
      const food = findCountableNutritionReference(foodName);
      expect(food, `referência canônica ausente para ${foodName}`).toBeDefined();
      return {
        segmentIndex,
        processed: materializeResolvedCountableMeal({
          resolved,
          food: food!,
          userTimezone: "America/Sao_Paulo",
        }),
      };
    });

    const result = await processMealInputWithPartialFailures(
      {
        text: registrationText,
        occurredAt: new Date("2026-09-30T12:00:00.000Z"),
        timeZone: "America/Sao_Paulo",
      },
      resolvedSegments,
    );

    expect(result.skippedSegments).toEqual([]);
    expect(result.processed.items).toHaveLength(5);
    for (const item of result.processed.items) {
      expect(item.source).toBe("catalog");
      expect(item.resolution?.nutritionOrigin).toBe("catalog");
      expect({
        calories: item.calories / (item.estimatedGrams / 100),
        protein: item.protein / (item.estimatedGrams / 100),
        carbs: item.carbs / (item.estimatedGrams / 100),
        fat: item.fat / (item.estimatedGrams / 100),
      }).not.toEqual(PLACEHOLDER_PER_100G);
    }

    const egg = result.processed.items[1];
    expect(egg).toMatchObject({
      foodName: "Ovo Frito",
      estimatedGrams: 50,
      calories: 120.1,
      protein: 7.8,
      carbs: 0.6,
      fat: 9.3,
    });

    const melon = result.processed.items[3];
    expect(melon).toMatchObject({
      foodName: "Melão",
      estimatedGrams: 278,
      resolution: { nutritionOrigin: "catalog" },
    });

    const adjustedMelon = scaleMealItem(melon, 148);
    expect(adjustedMelon).toMatchObject({
      foodName: "Melão",
      estimatedGrams: 148,
      resolution: { nutritionOrigin: "catalog" },
    });
    expect(adjustedMelon.calories).not.toBe(222);
    expect(adjustedMelon.protein).not.toBe(8.9);
    expect(adjustedMelon.carbs).not.toBe(22.2);
    expect(adjustedMelon.fat).not.toBe(7.4);
  });
});
