import { describe, expect, it } from "vitest";
import {
  addImageIdentityClarifications,
  buildMealSemanticContract,
} from "./mealSemanticContract";
import type { MealDraftItem } from "./nutritionEngineTypes";

function item(foodName: string): MealDraftItem {
  return {
    foodName,
    canonicalName: foodName,
    portionText: "1 unidade",
    quantity: 1,
    unit: "unidade",
    servings: 1,
    estimatedGrams: 100,
    calories: 100,
    protein: 3,
    carbs: 10,
    fat: 2,
    confidence: 0.8,
    source: "heuristic",
  };
}

describe("meal semantic contract visual identity", () => {
  it("marca somente o item visualmente ambíguo e preserva o item reconhecido", () => {
    const items = [item("Cerveja Lager"), item("item 2")];
    const contract = buildMealSemanticContract({
      processingInput: { imageUrl: "data:image/jpeg;base64,fixture" },
      sourceText: "",
      items,
    });

    const clarified = addImageIdentityClarifications({
      contract,
      items,
      itemIndexes: [1],
    });

    expect(clarified.items[0]).toMatchObject({
      commercialName: "Cerveja Lager",
      needsClarification: false,
      clarificationReason: null,
    });
    expect(clarified.items[1]).toMatchObject({
      commercialName: "item 2",
      needsClarification: true,
      clarificationReason: {
        code: "image_identity_unresolved",
      },
    });
    expect(clarified.clarifications).toEqual([
      expect.objectContaining({
        itemIndex: 1,
        code: "image_identity_unresolved",
      }),
    ]);
  });
});
