import { describe, expect, it } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngine";
import { buildWhatsAppMealReplyMessage } from "./replyMessages";

const WARNING = "⚠️ Valores nutricionais estimados pela IA.";
type Source = "heuristic" | "hybrid" | "catalog";

function food(foodName: string, source: Source, calories = 147) {
  return {
    foodName,
    canonicalName: foodName,
    quantity: 49,
    unit: "g",
    portionText: "49 g",
    servings: 0.49,
    estimatedGrams: 49,
    calories,
    protein: 3.92,
    carbs: 27.44,
    fat: 1.96,
    confidence: 0.72,
    source,
  };
}

function buildProcessedItems(sources: Source[]): MealProcessingResult {
  const items = sources.map((source, index) => food(`Alimento ${index + 1}`, source, 100 + index * 10));
  return {
    detectedMealLabel: "Lanche",
    sourceText: "refeição mista",
    imageUrl: undefined,
    audioUrl: undefined,
    transcript: undefined,
    confidence: 0.82,
    needsConfirmation: sources.some(source => source !== "catalog"),
    reasoning: "Teste de origens nutricionais.",
    items,
    totals: items.reduce((totals, item) => ({
      calories: totals.calories + item.calories,
      protein: totals.protein + item.protein,
      carbs: totals.carbs + item.carbs,
      fat: totals.fat + item.fat,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }),
  };
}

function warningCount(reply: string) {
  return reply.split(WARNING).length - 1;
}

describe("buildWhatsAppMealReplyMessage estimated nutrition", () => {
  it.each(["heuristic", "hybrid"] as const)("indica quando os macros do item usam origem %s", source => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedItems([source]));

    expect(reply).toContain("Alimento 1");
    expect(reply).toContain(WARNING);
    expect(warningCount(reply)).toBe(1);
  });

  it("não marca item integralmente proveniente do catálogo", () => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedItems(["catalog"]));
    expect(reply).not.toContain(WARNING);
  });

  it("em refeição mista marca somente heuristic e hybrid", () => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedItems(["catalog", "hybrid", "heuristic"]));

    expect(warningCount(reply)).toBe(2);
    expect(reply.indexOf("Alimento 1")).toBeLessThan(reply.indexOf("Alimento 2"));
    expect(reply.indexOf("Alimento 2")).toBeLessThan(reply.indexOf(WARNING));
    expect(reply.lastIndexOf(WARNING)).toBeGreaterThan(reply.indexOf("Alimento 3"));
  });

  it("exibe aviso individual para vários itens estimados", () => {
    const reply = buildWhatsAppMealReplyMessage(buildProcessedItems(["heuristic", "hybrid", "heuristic"]));
    expect(warningCount(reply)).toBe(3);
  });
});
