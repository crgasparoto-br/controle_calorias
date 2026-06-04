import { describe, expect, it } from "vitest";
import { buildWhatsAppMealReplyMessage } from "./replyMessages";
import type { MealProcessingResult } from "../../nutritionEngine";

describe("buildWhatsAppMealReplyMessage", () => {
  it("não mostra equivalência aproximada em gramas para porções líquidas em ml", () => {
    const processed: MealProcessingResult = {
      detectedMealLabel: "Café da manhã",
      sourceText: "whey, creatina e leite",
      items: [
        {
          foodName: "Leite integral",
          canonicalName: "Leite integral",
          portionText: "100 ml",
          servings: 1,
          estimatedGrams: 100,
          calories: 61,
          protein: 3.2,
          carbs: 4.7,
          fat: 3.3,
          confidence: 0.9,
          source: "catalog",
        },
      ],
      totals: {
        calories: 61,
        protein: 3.2,
        carbs: 4.7,
        fat: 3.3,
      },
    };

    const reply = buildWhatsAppMealReplyMessage(processed);

    expect(reply).toContain("• 🥛 Leite integral, 100 ml");
    expect(reply).not.toContain("aprox. 100 g");
  });

  it("mantém equivalência aproximada em gramas para porções unitárias", () => {
    const processed: MealProcessingResult = {
      detectedMealLabel: "Lanche",
      sourceText: "1 banana",
      items: [
        {
          foodName: "Banana",
          canonicalName: "Banana",
          portionText: "1 unidade",
          servings: 1,
          estimatedGrams: 80,
          calories: 72,
          protein: 0.9,
          carbs: 18.6,
          fat: 0.2,
          confidence: 0.9,
          source: "catalog",
        },
      ],
      totals: {
        calories: 72,
        protein: 0.9,
        carbs: 18.6,
        fat: 0.2,
      },
    };

    const reply = buildWhatsAppMealReplyMessage(processed);

    expect(reply).toContain("• 🍌 Banana, 1 unidade (aprox. 80 g)");
  });
});
