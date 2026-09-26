import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTextResponseMock, logMealInferenceFallbackMock } = vi.hoisted(() => ({
  createTextResponseMock: vi.fn(),
  logMealInferenceFallbackMock: vi.fn(),
}));

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));
vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));
vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: vi.fn(async () => null),
}));
vi.mock("./mealInferenceFallbackTelemetry", () => ({
  logMealInferenceFallback: (...args: unknown[]) => logMealInferenceFallbackMock(...args),
}));

const { processMealInput } = await import("./nutritionEngine");
const { findTacoFood } = await import("./tacoLookup");

function installInference(foodName: string) {
  createTextResponseMock.mockResolvedValue({
    id: "response-issue-1198",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.94,
      reasoning: "Alimento genérico reconhecido sem evidência de marca.",
      items: [{
        foodName,
        brand: null,
        quantity: 100,
        unit: "g",
        portionText: "100 g",
        servings: 1,
        estimatedGrams: 100,
        estimatedCalories: 150,
        estimatedMacros: { protein: 6, carbs: 15, fat: 5 },
        confidence: 0.92,
        foodClassification: {
          processingLevel: "processed",
          isFruit: false,
          isVegetable: false,
          fiberGrams: 0,
        },
      }],
    }),
    raw: {},
  });
}

beforeEach(() => {
  createTextResponseMock.mockReset();
  logMealInferenceFallbackMock.mockReset();
});

describe("issue #1198 — referência genérica no processamento real", () => {
  it("resolve o equivalente textual de Queijo Muçarela pelo catálogo/TACO", async () => {
    installInference("Queijo Muçarela");
    const reference = findTacoFood("Queijo Muçarela");

    const result = await processMealInput({
      text: "100 g de queijo muçarela",
    });

    expect(result.semanticContract.needsClarification).toBe(false);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Queijo Muçarela",
      canonicalName: "Queijo Mozarela",
      brand: null,
      source: "catalog",
      calories: expect.closeTo(reference!.calories, 1),
      resolution: expect.objectContaining({
        productVariant: null,
        nutritionOrigin: "catalog",
        nutritionVerified: true,
        ambiguity: null,
      }),
    }));
    expect(result.items[0].calories).not.toBe(150);
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith("generic_nutrition_fallback", expect.anything());
  });

  it("mantém a mesma decisão no caminho visual sem pedir variante comercial", async () => {
    installInference("Queijo Mozarela");

    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,issue-1198-generic-cheese",
    });

    expect(result.semanticContract.inputType).toBe("image");
    expect(result.semanticContract.needsClarification).toBe(false);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Queijo Mozarela",
      brand: null,
      source: "catalog",
      resolution: expect.objectContaining({
        productVariant: null,
        nutritionOrigin: "catalog",
        nutritionVerified: true,
      }),
    }));
    expect(result.items[0].calories).not.toBe(150);
  });

  it("mantém fail-closed para a variante light sem referência compatível", async () => {
    installInference("Queijo Muçarela light");

    await expect(processMealInput({
      imageUrl: "data:image/jpeg;base64,issue-1198-light-cheese",
    })).rejects.toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({
        clarificationReason: "commercial_identity_unverified",
      }),
    });
  });

  it("resolve Queijo Muçarela pelo catálogo mesmo quando a IA está indisponível", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const result = await processMealInput({
      text: "100 g de Queijo Muçarela",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Queijo Mozarela",
      source: "catalog",
      resolution: expect.objectContaining({
        productVariant: null,
        nutritionOrigin: "catalog",
        nutritionVerified: true,
      }),
    }));
    expect(result.items[0].calories).toBeGreaterThan(300);
    expect(result.semanticContract.needsClarification).toBe(false);
  });

  it.each([
    "100 g de Queijo Muçarela Marca X",
    "100 g de Queijo Muçarela light",
    "100 g de Queijo Muçarela zero",
    "100 g de Queijo Muçarela diet",
    "100 g de Queijo",
    "100 g de Chocolate",
    "100 g de Iogurte",
  ])("não permite que o fallback textual escolha uma referência genérica para %s", async text => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    await expect(processMealInput({ text })).rejects.toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({
        semanticContract: expect.objectContaining({ needsClarification: true }),
      }),
    });
  });
});
