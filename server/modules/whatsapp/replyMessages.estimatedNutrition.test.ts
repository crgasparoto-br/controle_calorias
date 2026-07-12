import { describe, expect, it } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngine";
import { buildWhatsAppMealReplyMessage } from "./replyMessages";

function buildProcessedItem(source: "heuristic" | "hybrid" | "catalog"): MealProcessingResult {
  return {
    detectedMealLabel: "Lanche",
    sourceText: "49g",
    imageUrl: "data:image/jpeg;base64,cGFvLWRhLWZhemVuZGE=",
    audioUrl: undefined,
    transcript: undefined,
    confidence: 0.82,
    needsConfirmation: source !== "catalog",
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
        source,
      },
    ],
    totals: {
      calories: 147,
      protein: 3.92,
      carbs: 27.44,
      fat: 1.96,
    },
  };
}

describe("buildWhatsAppMealReplyMessage estimated nutrition", () => {
  it.each(["heuristic", "hybrid"] as const)("indica quando os macros do item usam origem %s", source => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedItem(source));

    expect(reply).toContain("• 🍞 Pão da Fazenda — 49g");
    expect(reply).toContain("147 kcal | P 3,9 g | C 27,4 g | G 2 g");
    expect(reply).toContain("⚠️ Valores nutricionais estimados pela IA.");
  });

  it("não marca item integralmente proveniente do catálogo", () => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedItem("catalog"));

    expect(reply).not.toContain("⚠️ Valores nutricionais estimados pela IA.");
  });
});
