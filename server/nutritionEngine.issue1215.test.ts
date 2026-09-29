import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectWhatsappImageMealItemsPersistence } from "./modules/whatsapp/visualMealInferenceValidation";

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

function extractionResponse(items: Array<Record<string, unknown>>) {
  return {
    id: "resp-1215",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.92,
      reasoning: "Texto frontal legível da embalagem; quantidade visual contada.",
      items,
    }),
    raw: { mocked: true },
  };
}

function visualItem(overrides: Record<string, unknown> = {}) {
  return {
    foodName: "Cerveja Spaten Munich",
    brand: null,
    quantity: 2,
    unit: "lata",
    portionText: "2 latas",
    servings: 2,
    estimatedGrams: 0,
    estimatedCalories: 0,
    estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
    confidence: 0.92,
    foodClassification: {
      processingLevel: "ultra_processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 0,
      isPlainWater: false,
    },
    ...overrides,
  };
}

describe("issue #1215 — identidade comercial visual atravessa o pipeline real", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(null);
    vi.stubEnv("AI_MEAL_VISION_PROVIDER", "openai");
    vi.stubEnv("AI_MEAL_VISION_MODEL", "gpt-4.1-mini");
  });

  it("recupera marca/variante mescladas no foodName sem registrar nutrição genérica", async () => {
    createTextResponseMock.mockResolvedValue(
      extractionResponse([visualItem()]),
    );

    const { processMealInput } = await import("./nutritionEngine");
    const error = await processMealInput({
      imageUrl: "data:image/jpeg;base64,controlled-commercial-fixture",
    }).catch(value => value);

    expect(error).toMatchObject({
      code: "food_identity_clarification_required",
      context: {
        items: [
          expect.objectContaining({
            foodName: "Cerveja Spaten Munich",
            brand: "Spaten",
            quantity: 2,
            unit: "lata",
            resolution: expect.objectContaining({
              productVariant: "munich",
              nutritionVerified: false,
              // #1244: categoria, marca e variante foram lidas na imagem; a
              // pendência é nutricional, sem negar a identidade comercial.
              ambiguity: expect.objectContaining({
                reason: "commercial_nutrition_unverified",
              }),
            }),
          }),
        ],
      },
    });

    const persistedItems = error.context.items;
    expect(inspectWhatsappImageMealItemsPersistence(persistedItems)).toEqual({
      status: "persistable",
    });
    expect(error.context.semanticContract.items[0]).toEqual(
      expect.objectContaining({
        commercialName: "Cerveja Spaten Munich",
        brand: "Spaten",
        quantity: 2,
        needsClarification: true,
      }),
    );
  });

  it("faz uma segunda passagem da mesma MEAL_VISION quando a primeira resposta vem vazia", async () => {
    createTextResponseMock
      .mockResolvedValueOnce(extractionResponse([]))
      .mockResolvedValueOnce(
        extractionResponse([
          visualItem({
            foodName: "Bebida Aurora Vale Lager",
            brand: "Aurora Vale",
            quantity: 2,
            unit: "unidade",
            portionText: "2 unidades",
            estimatedGrams: 700,
            estimatedCalories: 230,
            estimatedMacros: { protein: 2, carbs: 18, fat: 0 },
          }),
        ]),
      );

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,controlled-commercial-fixture",
    });

    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        foodName: "Bebida Aurora Vale Lager",
        brand: "Aurora Vale",
        quantity: 2,
        resolution: expect.objectContaining({
          productVariant: "lager",
          nutritionOrigin: "provisional_estimate",
          nutritionVerified: false,
        }),
      }),
    );
    expect(result.semanticContract.needsClarification).toBe(false);

    const recoveryRequest = createTextResponseMock.mock.calls[1][0];
    expect(recoveryRequest.instructions).toContain("Passagem de recuperação");
    expect(JSON.stringify(recoveryRequest.input)).not.toContain("Aurora Vale");
  });

  it("mantém a resposta vazia como ausência global quando as duas passagens não veem alimento", async () => {
    createTextResponseMock
      .mockResolvedValueOnce(extractionResponse([]))
      .mockResolvedValueOnce(extractionResponse([]));

    const { processMealInput } = await import("./nutritionEngine");
    await expect(
      processMealInput({
        imageUrl: "data:image/jpeg;base64,controlled-empty-fixture",
      }),
    ).rejects.toMatchObject({
      code: "meal_inference_unavailable",
    });
    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
  });
});
