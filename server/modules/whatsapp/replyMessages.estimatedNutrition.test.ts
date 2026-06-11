import { describe, expect, it } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngine";
import { buildWhatsAppMealReplyMessage } from "./replyMessages";

describe("buildWhatsAppMealReplyMessage estimated nutrition", () => {
  it("indica quando os macros do item foram estimados por fallback heurístico", () => {
    const processed: MealProcessingResult = {
      detectedMealLabel: "Lanche",
      sourceText: "49g",
      imageUrl: "data:image/jpeg;base64,cGFvLWRhLWZhemVuZGE=",
      audioUrl: undefined,
      transcript: undefined,
      confidence: 0.82,
      needsConfirmation: true,
      reasoning: "Produto de padaria sem tabela nutricional visível.",
      items: [
        {
          foodName: "Pão da Fazenda",
          canonicalName: "Pão de padaria",
          quantity: 49,
          unit: "g",
          portionText: "49 g",
          servings: 0.49,
          estimatedGrams: 49,
          calories: 147,
          protein: 3.92,
          carbs: 27.44,
          fat: 1.96,
          confidence: 0.72,
          source: "heuristic",
        },
      ],
      totals: {
        calories: 147,
        protein: 3.92,
        carbs: 27.44,
        fat: 1.96,
      },
    };

    const reply = buildWhatsAppMealReplyMessage(processed);

    expect(reply).toContain("• 🍞 Pão da Fazenda, 49g (estimado) - 147 Kcal");
    expect(reply).toContain("Prot. 3,9 g | Carb. 27,4 g | Gord. 2 g");
  });
});
