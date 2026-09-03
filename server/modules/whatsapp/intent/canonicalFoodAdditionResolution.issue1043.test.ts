import { describe, expect, it, vi } from "vitest";
import { resolveCanonicalFoodAdditionItems } from "./canonicalFoodAdditionResolution";

function draftItem(overrides: Record<string, unknown> = {}) {
  return {
    foodName: "Presunto cozido",
    canonicalName: "Presunto cozido",
    quantity: 54,
    unit: "g",
    portionText: "54 g",
    servings: 1,
    estimatedGrams: 54,
    calories: 70,
    protein: 10,
    carbs: 1,
    fat: 2,
    confidence: 0.9,
    source: "hybrid",
    ...overrides,
  };
}

function runtime(kind: "contextual_estimate" | "user_learned") {
  return {
    resolveHouseholdMeasure: vi.fn(async () => ({
      kind,
      grams: 54,
      requestedQuantity: 3,
      requestedUnit: "fatia",
      evidence: kind === "user_learned" ? "Correção explícita do usuário." : "1 fatia pesa 18 g.",
      sourceUrls: kind === "user_learned" ? [] : ["https://example.com/presunto"],
      referenceCount: kind === "user_learned" ? 0 : 1,
    })),
    processMealInput: vi.fn(async () => ({
      detectedMealLabel: "Café da manhã",
      sourceText: "",
      reasoning: "",
      confidence: 0.9,
      needsConfirmation: false,
      items: [draftItem()],
      totals: { calories: 70, protein: 10, carbs: 1, fat: 2 },
    })),
  };
}

const date = new Date("2026-09-03T11:00:00.000Z");
const addition = {
  mealLabel: "Café da manhã",
  date,
  items: [{ foodName: "Presunto cozido", brand: null, quantity: 3, unit: "fatias" }],
};

describe("resolveCanonicalFoodAdditionItems (#1043)", () => {
  it.each(["contextual_estimate", "user_learned"] as const)(
    "mantém %s como aproximação, preserva a medida original e calcula com gramas",
    async kind => {
      const deps = runtime(kind);

      const result = await resolveCanonicalFoodAdditionItems({
        userId: 71,
        addition: addition as any,
        occurredAt: date,
        timeZone: "America/Sao_Paulo",
      }, deps as any);

      expect(deps.processMealInput).toHaveBeenCalledWith(expect.objectContaining({ text: "54 g de Presunto cozido" }));
      expect(result).toEqual({
        kind: "items",
        items: [expect.objectContaining({
          foodName: "Presunto cozido",
          quantity: 3,
          unit: "fatia",
          portionText: "3 fatia (aprox. 54 g)",
          estimatedGrams: 54,
          quantityResolution: expect.objectContaining({ kind, grams: 54 }),
        })],
      });
    },
  );
});
