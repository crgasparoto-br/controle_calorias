import { describe, expect, it, vi } from "vitest";
import { MealInferenceError } from "../../../nutritionEngine";
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
    processMealInput: vi.fn(async () => ({
      detectedMealLabel: "Café da manhã",
      sourceText: "",
      reasoning: "",
      confidence: 0.9,
      needsConfirmation: false,
      items: [draftItem()],
      totals: { calories: 21, protein: 3.2, carbs: 0.4, fat: 0.8 },
    })),
    resolveCommercialFoodIdentity: vi.fn(async (foodName: string, brand: string) => ({
      slug: `${foodName}-${brand}`,
      name: foodName,
      aliases: [foodName],
      brandName: brand,
      isBrandedProduct: true,
      servingLabel: "1 fatia (21 g)",
      gramsPerServing: 21,
      calories: 26,
      protein: 4,
      carbs: 0.5,
      fat: 1,
      researchIdentityKey: `verified:${foodName}:${brand}`,
      sourceUrls: ["https://example.com/rotulo"],
      sourceEvidence: "1 fatia = 21 g",
      sourceVerifiedAt: date,
      sourceConfidence: 0.95,
    })),
    resolveHouseholdMeasure: vi.fn(),
  };
}

const date = new Date("2026-08-25T11:00:00.000Z");

describe("resolveCanonicalFoodAdditionItems (#1016)", () => {
  it("usa gramatura da medida para escalar a nutrição específica da marca sem trocar a identidade nutricional", async () => {
    const deps = runtime();
    deps.resolveHouseholdMeasure.mockResolvedValueOnce({
      kind: "researched_exact",
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

    expect(deps.resolveCommercialFoodIdentity).toHaveBeenCalledWith(
      "Presunto cozido Sadia",
      "Sadia",
    );
    expect(deps.resolveHouseholdMeasure).toHaveBeenCalledWith(expect.objectContaining({
      brand: "Sadia",
      commercialFood: expect.objectContaining({ brandName: "Sadia" }),
    }));
    expect(deps.resolveCommercialFoodIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      deps.resolveHouseholdMeasure.mock.invocationCallOrder[0],
    );
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
        portionText: "1 fatia (21 g)",
        estimatedGrams: 21,
        calories: 26,
        source: "hybrid",
        quantityResolution: expect.objectContaining({
          kind: "researched_exact",
          grams: 21,
          sourceUrls: ["https://example.com/medida-presunto"],
        }),
      })],
    });
  });

  it("não exige acesso ao histórico de hábitos para reutilizar o pipeline nutricional canônico", async () => {
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

    await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Lanche",
        date,
        items: [{ foodName: "Queijo mussarela", brand: null, quantity: 37, unit: "g" }],
      },
      occurredAt: date,
      timeZone: "America/Sao_Paulo",
    }, deps as any);

    expect(deps.processMealInput).toHaveBeenCalledWith(expect.not.objectContaining({
      habits: expect.anything(),
    }));
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

  it("clarifica identidade de marca antes de pesquisar qualquer medida", async () => {
    const deps = runtime();
    deps.resolveCommercialFoodIdentity.mockRejectedValueOnce(new MealInferenceError(
      "Qual variante Panco você quis registrar?",
      {
        code: "food_identity_clarification_required",
        context: {
          originalText: "Pão de forma Panco",
          foodName: "Pão de forma Panco",
          brand: "Panco",
          clarificationReason: "brand_variant_unresolved",
          alternatives: [
            {
              name: "Pão de forma Panco Premium",
              brand: "Panco",
              productVariant: "premium",
              servingLabel: "2 fatias (50 g)",
              gramsPerServing: 50,
            },
            {
              name: "Pão de forma Panco Integral",
              brand: "Panco",
              productVariant: "integral",
              servingLabel: "2 fatias (60 g)",
              gramsPerServing: 60,
            },
          ],
        },
      },
    ));

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Café da manhã",
        date,
        items: [{ foodName: "Pão de forma Panco", brand: "Panco", quantity: 2, unit: "fatia" }],
      },
      occurredAt: date,
      timeZone: "America/Sao_Paulo",
    }, deps as any);

    expect(result).toMatchObject({
      kind: "identity_clarification",
      itemIndex: 0,
      context: {
        brand: "Panco",
        clarificationReason: "brand_variant_unresolved",
      },
    });
    expect(deps.resolveCommercialFoodIdentity).toHaveBeenCalledOnce();
    expect(deps.resolveHouseholdMeasure).not.toHaveBeenCalled();
    expect(deps.processMealInput).not.toHaveBeenCalled();
  });

  it("só permite clarificação de peso depois que a identidade comercial foi comprovada", async () => {
    const deps = runtime();
    deps.resolveHouseholdMeasure.mockResolvedValueOnce(null);

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Café da manhã",
        date,
        items: [{ foodName: "Pão de forma Panco Premium", brand: "Panco", quantity: 2, unit: "fatia" }],
      },
      occurredAt: date,
      timeZone: "America/Sao_Paulo",
    }, deps as any);

    expect(result).toMatchObject({
      kind: "quantity_clarification",
      itemIndex: 0,
    });
    expect(deps.resolveCommercialFoodIdentity).toHaveBeenCalledWith(
      "Pão de forma Panco Premium",
      "Panco",
    );
    expect(deps.resolveHouseholdMeasure).toHaveBeenCalledWith(expect.objectContaining({
      brand: "Panco",
      commercialFood: expect.objectContaining({ brandName: "Panco" }),
    }));
    expect(deps.resolveCommercialFoodIdentity.mock.invocationCallOrder[0]).toBeLessThan(
      deps.resolveHouseholdMeasure.mock.invocationCallOrder[0],
    );
  });

  it("reutiliza itens já resolvidos sem recalcular identidade ou medida na continuação", async () => {
    const deps = runtime();
    const preserved = draftItem({
      foodName: "Leite integral",
      canonicalName: "Leite integral",
      brand: null,
      quantity: 50,
      unit: "ml",
      portionText: "50 ml",
      estimatedGrams: 50,
    }) as any;
    deps.resolveHouseholdMeasure.mockResolvedValueOnce({
      kind: "canonical_portion",
      grams: 20,
      requestedQuantity: 1,
      requestedUnit: "fatia",
      evidence: "1 fatia = 20 g",
      sourceUrls: [],
      referenceCount: 1,
    });
    deps.processMealInput.mockResolvedValueOnce({
      detectedMealLabel: "Café da manhã",
      sourceText: "",
      reasoning: "",
      confidence: 0.9,
      needsConfirmation: false,
      items: [draftItem({
        foodName: "Queijo mussarela",
        canonicalName: "Queijo mussarela",
        brand: null,
        estimatedGrams: 20,
      })],
      totals: { calories: 21, protein: 3.2, carbs: 0.4, fat: 0.8 },
    } as any);

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Café da manhã",
        date,
        items: [
          { foodName: "Leite integral", brand: null, quantity: 50, unit: "ml" },
          { foodName: "Queijo mussarela", brand: null, quantity: 1, unit: "fatia" },
        ],
      },
      occurredAt: date,
      timeZone: "America/Sao_Paulo",
      resolvedItems: [preserved],
    }, deps as any);

    expect(result).toMatchObject({
      kind: "items",
      items: [preserved, expect.objectContaining({ foodName: "Queijo mussarela" })],
    });
    expect(deps.processMealInput).toHaveBeenCalledOnce();
    expect(deps.resolveHouseholdMeasure).toHaveBeenCalledOnce();
    expect(deps.processMealInput).not.toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringMatching(/Leite integral/i),
    }));
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
