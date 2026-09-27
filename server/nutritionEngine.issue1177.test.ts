import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({ createTextResponse: createTextResponseMock }),
}));
vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));
vi.mock("./catalogRuntime", () => ({ getCatalogCache: () => [] }));
vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => findCatalogFoodSemanticMock(...args),
}));

function visualItem(input: {
  foodName: string;
  quantity: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence?: number;
}) {
  return {
    foodName: input.foodName,
    brand: null,
    quantity: input.quantity,
    unit: input.unit,
    portionText: `${input.quantity} ${input.unit}`,
    servings: 1,
    estimatedGrams: input.quantity,
    estimatedCalories: input.calories,
    estimatedMacros: {
      protein: input.protein,
      carbs: input.carbs,
      fat: input.fat,
    },
    confidence: input.confidence ?? 0.9,
    foodClassification: {
      processingLevel: "natural_or_minimally_processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 1,
      isPlainWater: false,
    },
  };
}

describe("issue #1177 — um item visual ambíguo não apaga uma refeição multi-item", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(null);
    vi.stubEnv("AI_MEAL_VISION_PROVIDER", "openai");
    vi.stubEnv("AI_MEAL_VISION_MODEL", "gpt-4.1-mini");
  });

  it("preserva dois componentes confiáveis e direciona somente o item sem identidade para clarificação", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp-1177-reopened",
      outputText: JSON.stringify({
        mealLabel: "Almoço",
        confidence: 0.82,
        reasoning: "Três componentes visíveis; o item central não tem texto suficiente para identidade.",
        items: [
          visualItem({
            foodName: "Frango grelhado",
            quantity: 120,
            unit: "g",
            calories: 198,
            protein: 37,
            carbs: 0,
            fat: 4,
          }),
          visualItem({
            foodName: "item 2",
            quantity: 80,
            unit: "g",
            calories: 60,
            protein: 2,
            carbs: 12,
            fat: 0.5,
            confidence: 0.42,
          }),
          visualItem({
            foodName: "Couve-flor assada em rodelas",
            quantity: 90,
            unit: "g",
            calories: 30,
            protein: 2,
            carbs: 5,
            fat: 0.4,
          }),
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const { inspectWhatsappImageMealItemsPersistence } = await import(
      "./modules/whatsapp/visualMealInferenceValidation"
    );
    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,controlled-multi-item-fixture",
    });

    expect(result.items).toHaveLength(3);
    expect(result.items.map(item => item.foodName)).toEqual([
      "Frango Grelhado",
      "Item 2",
      "Couve-Flor Assada em Rodelas",
    ]);
    expect(result.semanticContract.needsClarification).toBe(false);
    expect(inspectWhatsappImageMealItemsPersistence(result.items)).toEqual({
      status: "missing_identity",
      itemIndexes: [1],
    });
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
  });
});
