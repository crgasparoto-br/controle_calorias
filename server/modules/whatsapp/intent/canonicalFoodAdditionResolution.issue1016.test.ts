import { describe, expect, it, vi } from "vitest";
import { resolveCanonicalFoodAdditionItems } from "./canonicalFoodAdditionResolution";

function draftItem(overrides: Record<string, unknown> = {}) {
  return {
    foodName: "Presunto cozido Sadia",
    canonicalName: "Presunto cozido Sadia",
    brand: "Sadia",
    quantity: 17,
    unit: "g",
    portionText: "17 g",
    servings: 0.17,
    estimatedGrams: 17,
    calories: 21,
    protein: 3.2,
    carbs: 0.4,
    fat: 0.8,
    confidence: 0.94,
    source: "hybrid",
    nutritionSource: {
      sourceType: "brand_verified",
      sourceName: "rótulo Sadia",
    },
    ...overrides,
  };
}

function runtime() {
  return {
    getHabitSnapshots: vi.fn(async () => []),
    processMealInput: vi.fn(async () => ({
      detectedMealLabel: "Café da manhã",
      sourceText: "",
      reasoning: "",
      confidence: 0.9,
      needsConfirmation: false,
      items: [draftItem()],
      totals: { calories: 21, protein: 3.2, carbs: 0.4, fat: 0.8 },
    })),
    resolveHouseholdMeasure: vi.fn(),
  };
}

const date = new Date("2026-08-25T11:00:00.000Z");

describe("resolveCanonicalFoodAdditionItems (#1016)", () => {
  it("usa gramatura da medida para escalar a nutrição específica da marca sem trocar a identidade nutricional", async () => {
    const deps = runtime();
    deps.resolveHouseholdMeasure.mockResolvedValueOnce({
      kind: "usual_average",
      grams: 21,
      requestedQuantity: 1,
      requestedUnit: "fatia",
      evidence: "Fatia típica de presunto cozido: 21 g.",
      sourceUrls: ["https://example.com/medida-presunto"],
      referenceCount: 2,
    });
    deps.processMealInput.mockResolvedValueOnce({
      detectedMealLabel: "Café da manhã",
      sourceText: "",
      reasoning: "",
      confidence: 0.95,
      needsConfirmation: false,
      items: [draftItem({
        quantity: 21,
        estimatedGrams: 21,
        portionText: "21 g",
        calories: 26,
        protein: 4,
        carbs: 0.5,
        fat: 1,
      })],
      totals: { calories: 26, protein: 4, carbs: 0.5, fat: 1 },
    } as any);

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Café da manhã",
        date,
        items: [{
          foodName: "Presunto cozido Sadia",
          brand: "Sadia",
          quantity: 1,
          unit: "fatia",
        }],
      },
      occurredAt: date,
      timeZone: "America/Sao_Paulo",
    }, deps as any);

    expect(deps.processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "21 g de Presunto cozido Sadia",
    }));
    expect(result).toEqual({
      kind: "items",
      items: [expect.objectContaining({
        foodName: "Presunto cozido Sadia",
        canonicalName: "Presunto cozido Sadia",
        brand: "Sadia",
        quantity: 1,
        unit: "fatia",
        portionText: "1 fatia (aprox. 21 g)",
        estimatedGrams: 21,
        calories: 26,
        source: "hybrid",
        quantityResolution: expect.objectContaining({
          kind: "usual_average",
          grams: 21,
          sourceUrls: ["https://example.com/medida-presunto"],
        }),
      })],
    });
  });

  it("não pesquisa medida quando o usuário já informou massa explícita", async () => {
    const deps = runtime();
    deps.processMealInput.mockResolvedValueOnce({
      detectedMealLabel: "Lanche",
      sourceText: "",
      reasoning: "",
      confidence: 0.95,
      needsConfirmation: false,
      items: [draftItem({
        foodName: "Queijo mussarela",
        canonicalName: "Queijo mussarela",
        brand: null,
        quantity: 37,
        unit: "g",
        portionText: "37 g",
        estimatedGrams: 37,
      })],
      totals: { calories: 100, protein: 8, carbs: 1, fat: 7 },
    } as any);

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Lanche",
        date,
        items: [{ foodName: "Queijo mussarela", brand: null, quantity: 37, unit: "g" }],
      },
      occurredAt: date,
      timeZone: "America/Sao_Paulo",
    }, deps as any);

    expect(deps.resolveHouseholdMeasure).not.toHaveBeenCalled();
    expect(deps.processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "37 g de Queijo mussarela",
    }));
    expect(result).toEqual({
      kind: "items",
      items: [expect.objectContaining({
        quantity: 37,
        unit: "g",
        estimatedGrams: 37,
        quantityResolution: expect.objectContaining({
          kind: "explicit_mass_or_volume",
          grams: 37,
        }),
      })],
    });
  });

  it("clarifica somente depois que a medida caseira não pôde ser resolvida", async () => {
    const deps = runtime();
    deps.resolveHouseholdMeasure.mockResolvedValueOnce(null);

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Café da manhã",
        date,
        items: [{ foodName: "Requeijão cremoso", brand: null, quantity: 1, unit: "fatia" }],
      },
      occurredAt: date,
      timeZone: "America/Sao_Paulo",
    }, deps as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "quantity_clarification",
      itemIndex: 0,
      item: expect.objectContaining({ foodName: "Requeijão cremoso", unit: "fatia" }),
    }));
    expect(deps.processMealInput).not.toHaveBeenCalled();
  });

  it("resolve todos os itens antes de devolver o lote, sem produzir resultado parcial", async () => {
    const deps = runtime();
    deps.resolveHouseholdMeasure
      .mockResolvedValueOnce({
        kind: "canonical_portion",
        grams: 18,
        requestedQuantity: 1,
        requestedUnit: "fatia",
        evidence: "1 fatia = 18 g",
        sourceUrls: [],
        referenceCount: 1,
      })
      .mockResolvedValueOnce(null);
    deps.processMealInput.mockResolvedValueOnce({
      detectedMealLabel: "Café da manhã",
      sourceText: "",
      reasoning: "",
      confidence: 0.9,
      needsConfirmation: false,
      items: [draftItem({ estimatedGrams: 18 })],
      totals: { calories: 21, protein: 3.2, carbs: 0.4, fat: 0.8 },
    } as any);

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Café da manhã",
        date,
        items: [
          { foodName: "Presunto cozido Sadia", brand: "Sadia", quantity: 1, unit: "fatia" },
          { foodName: "Requeijão cremoso", brand: null, quantity: 1, unit: "fatia" },
        ],
      },
      occurredAt: date,
      timeZone: "America/Sao_Paulo",
    }, deps as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "quantity_clarification",
      itemIndex: 1,
      resolvedItems: [expect.objectContaining({ foodName: "Presunto cozido Sadia" })],
    }));
  });
});
