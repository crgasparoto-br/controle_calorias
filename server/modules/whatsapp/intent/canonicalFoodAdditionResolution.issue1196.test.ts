import { describe, expect, it, vi } from "vitest";
import type { MealItemInput } from "../../meals/schemas";
import { resolveCanonicalFoodAdditionItems } from "./canonicalFoodAdditionResolution";

function processedItem(foodName: string, grams: number): MealItemInput {
  return {
    foodName,
    canonicalName: foodName,
    portionText: `${grams} g`,
    servings: 1,
    estimatedGrams: grams,
    calories: 60,
    protein: 1,
    carbs: 10,
    fat: 1,
    confidence: 0.9,
    source: "catalog",
  };
}

describe("issue #1196 — referência natural na adição canônica", () => {
  it("usa pera/uva somente para pesquisar quantidade e preserva identidade e multiplicador", async () => {
    const measureInputs: Array<Record<string, unknown>> = [];
    const resolveHouseholdMeasure = vi.fn(async (input: Record<string, unknown>) => {
      measureInputs.push(input);
      const baseGrams = input.quantityReferenceFoodName === "pera" ? 150 : 5;
      const quantity = Number(input.quantity);
      return {
        kind: "contextual_estimate" as const,
        grams: baseGrams * quantity,
        requestedQuantity: quantity,
        requestedUnit: input.unit as string,
        evidence: `1 unidade pesa ${baseGrams} g.`,
        sourceUrls: ["https://example.test/measure"],
        referenceCount: 1,
      };
    });

    const result = await resolveCanonicalFoodAdditionItems(
      {
        userId: 1196,
        addition: {
          mealLabel: "Lanche da tarde",
          date: new Date("2026-09-30T15:00:00.000Z"),
          items: [
            { foodName: "pêra packans", brand: null, quantity: 1, unit: "un" },
            { foodName: "uvas pretas", brand: null, quantity: 6, unit: "un" },
          ],
        },
        occurredAt: new Date("2026-09-30T15:00:00.000Z"),
        timeZone: "America/Sao_Paulo",
      },
      {
        resolveHouseholdMeasure,
        resolveCommercialFoodIdentity: vi.fn(),
        processMealInput: vi.fn(async ({ text }: { text: string }) => ({
          items: [processedItem(
            text.includes("pêra packans") ? "pêra packans" : "uvas pretas",
            Number(text.match(/^(\d+(?:\.\d+)?)/u)?.[1] ?? 0),
          )],
        })),
      },
    );

    expect(result).toMatchObject({
      kind: "items",
      items: [
        expect.objectContaining({
          foodName: "pêra packans",
          estimatedGrams: 150,
          quantity: 1,
          quantityResolution: expect.objectContaining({ kind: "contextual_estimate", grams: 150 }),
        }),
        expect.objectContaining({
          foodName: "uvas pretas",
          estimatedGrams: 30,
          quantity: 6,
          quantityResolution: expect.objectContaining({ kind: "contextual_estimate", grams: 30 }),
        }),
      ],
    });
    expect(measureInputs).toEqual([
      expect.objectContaining({
        foodName: "pêra packans",
        quantityReferenceFoodName: "pera",
        quantity: 1,
      }),
      expect.objectContaining({
        foodName: "uvas pretas",
        quantityReferenceFoodName: "uva",
        quantity: 6,
      }),
    ]);
  });
});
