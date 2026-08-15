import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTextResponseMock, findCatalogFoodSemanticMock, logMealInferenceFallbackMock } = vi.hoisted(() => ({
  createTextResponseMock: vi.fn(),
  findCatalogFoodSemanticMock: vi.fn(async () => null),
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
  findCatalogFoodSemantic: findCatalogFoodSemanticMock,
}));
vi.mock("./mealInferenceFallbackTelemetry", () => ({
  logMealInferenceFallback: logMealInferenceFallbackMock,
}));

describe("nutritionEngine issue #982", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockClear();
    logMealInferenceFallbackMock.mockReset();
  });

  it("não descarta bolo de pote quando a IA está indisponível", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "244g bolo de pote ninho cremoso" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Bolo de Pote Ninho Cremoso",
      quantity: 244,
      unit: "g",
      estimatedGrams: 244,
    }));
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("ai_unavailable_or_error", 1);
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("catalog_miss", 1);
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("generic_nutrition_fallback", 1);
  });


  it("preserva alimento conhecido em recipiente mesmo sem de/com", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "244g copo açaí" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Copo Açaí",
      quantity: 244,
      unit: "g",
      estimatedGrams: 244,
    }));
  });

  it("remove objeto inédito após conector no fallback local", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));

    const { MealInferenceError, processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text: "244g copo de brinquedo" })).rejects.toBeInstanceOf(MealInferenceError);
  });

  it("preserva preparação fora da TACO no fallback local mesmo com recipiente", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "244g copo de smoothie de pitaya" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Copo de Smoothie de Pitaya",
      quantity: 244,
      unit: "g",
      estimatedGrams: 244,
      source: "heuristic",
    }));
    expect(findCatalogFoodSemanticMock).not.toHaveBeenCalled();
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("ai_unavailable_or_error", 1);
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("catalog_miss", 1);
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("generic_nutrition_fallback", 1);
  });

  it("resolve ameixa roxa pela TACO local preservando 230 g e sem embeddings", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "230g ameixa roxa" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Ameixa Roxa",
      quantity: 230,
      unit: "g",
      estimatedGrams: 230,
      source: "catalog",
    }));
    expect(result.items[0].canonicalName).toMatch(/Ameixa.*Crua/i);
    expect(result.items[0].calories).toBeCloseTo(120.8, 1);
    expect(result.items[0].calories).not.toBe(345);
    expect(result.items[0].protein).not.toBe(13.8);
    expect(result.items[0].carbs).not.toBe(34.5);
    expect(result.items[0].fat).not.toBe(11.5);
    expect(findCatalogFoodSemanticMock).not.toHaveBeenCalled();
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith("catalog_miss", expect.anything());
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith("generic_nutrition_fallback", expect.anything());
  });

  it("mantém variante específica de ameixa em calda em vez de cair em ameixa crua", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "230g ameixa em calda" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(230);
    expect(result.items[0].unit).toBe("g");
    expect(result.items[0].canonicalName).toMatch(/calda/i);
    expect(result.items[0].canonicalName).not.toMatch(/^Ameixa,? Crua$/i);
    expect(findCatalogFoodSemanticMock).not.toHaveBeenCalled();
  });

  it("registra ai_empty_items quando a IA retorna zero itens e usa o texto", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "response-empty",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.2,
        reasoning: "Nenhum item seguro.",
        items: [],
      }),
      raw: {},
    });

    const { processMealInput } = await import("./nutritionEngine");
    await processMealInput({ text: "banana" });

    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("ai_empty_items", 1);
  });

  it("registra ai_items_rejected quando todos os itens da IA contradizem o texto", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "response-rejected",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.8,
        reasoning: "Item incorreto de propósito para o teste.",
        items: [{
          foodName: "arroz",
          brand: null,
          quantity: 1,
          unit: "porção",
          portionText: "1 porção",
          servings: 1,
          estimatedGrams: 100,
          estimatedCalories: 130,
          estimatedMacros: { protein: 2.7, carbs: 28, fat: 0.3 },
          confidence: 0.8,
          foodClassification: {
            processingLevel: "natural_or_minimally_processed",
            isFruit: false,
            isVegetable: false,
            fiberGrams: 1,
          },
        }],
      }),
      raw: {},
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "banana" });

    expect(result.items[0].foodName).toMatch(/banana/i);
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("ai_items_rejected", 1);
  });
});
