import { describe, expect, it, vi } from "vitest";
import { findCatalogFood } from "./catalogMatching";
import { prepareCountableFoodRegistrationResolved } from "./countableFoodQuantity";
import { resolveHouseholdMeasure } from "./householdMeasureResolution";
import { resolveCanonicalFoodAdditionItems } from "./modules/whatsapp/intent/canonicalFoodAdditionResolution";

function baseRuntime() {
  return {
    searchGlobalFoodCatalog: vi.fn(async () => []),
    getGlobalFoodCatalogItem: vi.fn(),
    convertFoodPortionToGrams: vi.fn(),
    resolveCapabilityConfig: vi.fn(() => ({
      state: "enabled",
      primary: { provider: "openai", model: "test" },
      fallbacks: [],
    })),
    executeResolvedCapability: vi.fn(async (_policy: unknown, execute: (attempt: any) => Promise<any>) => ({
      value: await execute({ provider: { id: "openai" }, model: "test", signal: undefined }),
      provider: "openai",
      model: "test",
    })),
    createDomainTextResponse: vi.fn(),
  };
}

function runtimeWithStoredPortion(input: {
  foodName: string;
  brandName?: string | null;
  portionLabel: string;
  portionUnit: string;
  portionQuantity: number;
  portionGrams: number;
  convertedGrams: number;
}) {
  const runtime = baseRuntime();
  runtime.searchGlobalFoodCatalog.mockResolvedValueOnce([{
    id: `stored-${input.foodName}`,
    name: input.foodName,
    brandName: input.brandName ?? null,
  }] as any);
  runtime.getGlobalFoodCatalogItem.mockResolvedValueOnce({
    id: `stored-${input.foodName}`,
    name: input.foodName,
    brandName: input.brandName ?? null,
    portions: [{
      id: `portion-${input.foodName}`,
      label: input.portionLabel,
      unit: input.portionUnit,
      quantity: input.portionQuantity,
      grams: input.portionGrams,
    }],
  } as any);
  runtime.convertFoodPortionToGrams.mockResolvedValueOnce({
    grams: input.convertedGrams,
  } as any);
  return runtime;
}

function searchedResponse(references: Array<Record<string, unknown>>) {
  return {
    id: "resp-regression-1016",
    outputText: JSON.stringify({ found: true, references }),
    webSearch: {
      executed: true,
      searchCount: 1,
      sources: references.map(reference => ({
        url: reference.sourceUrl,
        title: "Tabela de porções",
        supportingText: [String(reference.evidence)],
      })),
    },
    raw: {},
  };
}

function slicedFoodReference(input: {
  sourceUrl: string;
  matchedFoodName: string;
  grams: number;
  evidence: string;
}) {
  return {
    matchedFoodName: input.matchedFoodName,
    foodTypeName: "mussarela",
    brandName: input.matchedFoodName.replace(/^Mussarela\s*/u, ""),
    measureUnit: "fatia",
    measureQuantity: 2,
    grams: input.grams,
    referenceKind: "same_food_type",
    describesTypicalMeasure: false,
    sourceUrl: input.sourceUrl,
    evidence: input.evidence,
  };
}

describe("regressão #1016 — medidas caseiras no WhatsApp", () => {
  it("usa a porção persistida antes da porção estática quando as duas divergem", async () => {
    const runtime = runtimeWithStoredPortion({
      foodName: "Pão francês",
      portionLabel: "1 unidade",
      portionUnit: "un",
      portionQuantity: 1,
      portionGrams: 45,
      convertedGrams: 67.5,
    });

    expect(findCatalogFood("Pão francês", 7)).toEqual(expect.objectContaining({
      servingLabel: "1 unidade",
      gramsPerServing: 50,
    }));

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Pão francês",
      quantity: 1.5,
      unit: "un",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "canonical_portion",
      grams: 67.5,
      requestedQuantity: 1.5,
      requestedUnit: "unidade",
    }));
    expect(runtime.searchGlobalFoodCatalog).toHaveBeenCalledTimes(1);
    expect(runtime.convertFoodPortionToGrams).toHaveBeenCalledWith(7, expect.objectContaining({
      quantity: 1.5,
    }));
    expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "banana por unidade",
      foodName: "Banana",
      brandName: null,
      quantity: 1,
      unit: "un",
      portionLabel: "1 unidade",
      portionUnit: "un",
      portionGrams: 70,
      convertedGrams: 70,
      staticGramsPerServing: 80,
    },
    {
      label: "queijo Polenghi por fatia",
      foodName: "Queijo Polenghi light",
      brandName: "Polenghi",
      quantity: 2,
      unit: "fatias",
      portionLabel: "1 fatia",
      portionUnit: "fatia",
      portionGrams: 18,
      convertedGrams: 36,
      staticGramsPerServing: 20,
    },
  ])("mantém a precedência persistida no caso irmão: $label", async ({
    foodName, brandName, quantity, unit, portionLabel, portionUnit, portionGrams, convertedGrams, staticGramsPerServing,
  }) => {
    const runtime = runtimeWithStoredPortion({
      foodName,
      brandName,
      portionLabel,
      portionUnit,
      portionQuantity: 1,
      portionGrams,
      convertedGrams,
    });

    expect(findCatalogFood(foodName, 7)).toEqual(expect.objectContaining({
      gramsPerServing: staticGramsPerServing,
    }));

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName,
      quantity,
      unit,
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({ grams: convertedGrams }));
    expect(runtime.convertFoodPortionToGrams).toHaveBeenCalledTimes(1);
    expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();
  });

  it("usa a porção estática somente quando nenhuma porção persistida segura existe", async () => {
    const runtime = baseRuntime();

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Pão francês",
      quantity: 1.5,
      unit: "un",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "canonical_portion",
      grams: 75,
      requestedQuantity: 1.5,
      requestedUnit: "unidade",
    }));
    expect(runtime.searchGlobalFoodCatalog).toHaveBeenCalledTimes(1);
    expect(runtime.createDomainTextResponse).not.toHaveBeenCalled();
  });

  it("mantém a mesma conversão no registro normal e no fluxo de adicionar à refeição", async () => {
    const normalRegistration = await prepareCountableFoodRegistrationResolved(
      7,
      "1,5 pão francês",
    );
    expect(normalRegistration.pendingItems).toEqual([]);
    expect(normalRegistration.registrationText).toBe("75 g de pão francês");

    const processMealInput = vi.fn(async () => ({
      detectedMealLabel: "Café da manhã",
      sourceText: "75 g de Pão francês",
      reasoning: "",
      confidence: 0.99,
      needsConfirmation: false,
      items: [{
        foodName: "Pão francês",
        canonicalName: "Pão francês",
        brand: null,
        quantity: 75,
        unit: "g",
        portionText: "75 g",
        servings: 1.5,
        estimatedGrams: 75,
        calories: 202.5,
        protein: 6.75,
        carbs: 42,
        fat: 2.25,
        confidence: 0.99,
        source: "catalog",
      }],
      totals: { calories: 202.5, protein: 6.75, carbs: 42, fat: 2.25 },
    }));

    const result = await resolveCanonicalFoodAdditionItems({
      userId: 7,
      addition: {
        mealLabel: "Café da manhã",
        date: new Date("2026-08-28T14:35:00.000Z"),
        items: [{ foodName: "Pão francês", brand: null, quantity: 1.5, unit: "un" }],
      },
      occurredAt: new Date("2026-08-28T14:35:00.000Z"),
      timeZone: "America/Sao_Paulo",
    }, {
      processMealInput: processMealInput as any,
      resolveHouseholdMeasure,
    });

    expect(processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "75 g de Pão francês",
    }));
    expect(result).toEqual({
      kind: "items",
      items: [expect.objectContaining({
        quantity: 1.5,
        unit: "un",
        estimatedGrams: 75,
        quantityResolution: expect.objectContaining({
          kind: "canonical_portion",
          grams: 75,
        }),
      })],
    });
  });

  it("aceita evidência verificável de rótulo no formato massa antes da medida e calcula média usual multi-fonte", async () => {
    const runtime = baseRuntime();
    const first = slicedFoodReference({
      sourceUrl: "https://example.com/mussarela-a",
      matchedFoodName: "Mussarela Marca A",
      grams: 40,
      evidence: "Queijo mussarela Marca A — Porção de 40 g (2 fatias).",
    });
    const second = slicedFoodReference({
      sourceUrl: "https://example.org/mussarela-b",
      matchedFoodName: "Mussarela Marca B",
      grams: 42,
      evidence: "Queijo mussarela Marca B — Porção de 42 g (2 fatias).",
    });
    runtime.createDomainTextResponse.mockResolvedValueOnce(
      searchedResponse([first, second]) as any,
    );

    const result = await resolveHouseholdMeasure({
      userId: 7,
      foodName: "Queijo mussarela",
      quantity: 2,
      unit: "fatias",
    }, runtime as any);

    expect(result).toEqual(expect.objectContaining({
      kind: "usual_average",
      grams: 41,
      requestedQuantity: 2,
      requestedUnit: "fatia",
      referenceCount: 2,
    }));
  });
});
