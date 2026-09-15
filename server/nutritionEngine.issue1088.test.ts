import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood } from "./nutritionEngineTypes";

const {
  createTextResponseMock,
  findCatalogFoodSemanticMock,
  logMealInferenceFallbackMock,
} = vi.hoisted(() => ({
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
  findCatalogFoodSemantic: (...args: unknown[]) =>
    findCatalogFoodSemanticMock(...args),
}));
vi.mock("./mealInferenceFallbackTelemetry", () => ({
  logMealInferenceFallback: (...args: unknown[]) =>
    logMealInferenceFallbackMock(...args),
}));

const { MealInferenceError, processMealInput } = await import(
  "./nutritionEngine"
);
const { inferUnresolvedCommercialIdentityHint } = await import(
  "./catalogMatching"
);
const { createConfirmedMealRegistrationService } = await import(
  "./modules/whatsapp/confirmedMealRegistration"
);

const NOW = new Date("2026-09-15T12:00:00.000Z");
const COMMERCIAL_TEXT = "15g de manteiga Batavo extra com sal";

function installAiFailure() {
  createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));
}

function installAiEmpty() {
  createTextResponseMock.mockResolvedValue({
    id: "response-empty-1088",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.2,
      reasoning: "Nenhum item seguro.",
      items: [],
    }),
    raw: {},
  });
}

function installAiRejectedItem() {
  createTextResponseMock.mockResolvedValue({
    id: "response-rejected-1088",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.8,
      reasoning: "Item incompatível com o texto.",
      items: [
        {
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
          processingLevel: "processed",
          isFruit: false,
          isVegetable: false,
          fiberGrams: 0,
          isPlainWater: false,
        },
      },
      ],
    }),
    raw: {},
  });
}

function verifiedCommercialFood(): CatalogFood {
  return {
    slug: "web-nutrition-manteiga-batavo-extra-com-sal",
    name: "Manteiga Batavo Extra com Sal",
    aliases: ["manteiga Batavo extra com sal"],
    servingLabel: "100 g",
    gramsPerServing: 100,
    calories: 700,
    protein: 0.5,
    carbs: 1,
    fat: 78,
    brandName: "Batavo",
    productVariant: null,
    variants: ["Manteiga Batavo Extra com Sal"],
    researchIdentityKey: "nutrition-research-v1:manteiga-batavo-extra-com-sal",
    sourceUrls: ["https://fabricante.example/batavo/manteiga-extra-com-sal"],
    sourceEvidence:
      "Porção de 100 g: 700 kcal, 0,5 g proteínas, 1 g carboidratos e 78 g gorduras.",
    sourceVerifiedAt: NOW,
    sourceConfidence: 0.95,
    isBrandedProduct: true,
  };
}

beforeEach(() => {
  createTextResponseMock.mockReset();
  findCatalogFoodSemanticMock.mockReset();
  findCatalogFoodSemanticMock.mockResolvedValue(null);
  logMealInferenceFallbackMock.mockReset();
});

describe("issue #1088 — identidade comercial no fallback textual", () => {
  it("preserva Batavo como marca pendente sem depender de KNOWN_BRANDS", () => {
    expect(
      inferUnresolvedCommercialIdentityHint("manteiga Batavo extra com sal")
    ).toEqual({
      brand: "Batavo",
      productVariant: null,
    });
    expect(
      inferUnresolvedCommercialIdentityHint("manteiga Koala extra com sal")
    ).toEqual({
      brand: "Koala",
      productVariant: null,
    });
    expect(
      inferUnresolvedCommercialIdentityHint("manteiga Koala com sal")
    ).toEqual({
      brand: "Koala",
      productVariant: null,
    });
  });

  it.each([
    "manteiga com sal",
    "iogurte natural",
    "água tônica",
    "pão e manteiga",
    "manteiga sabor chocolate",
  ])("não promove descrição genérica a marca desconhecida: %s", foodName => {
    expect(inferUnresolvedCommercialIdentityHint(foodName)).toBeNull();
  });

  it.each([
    ["IA indisponível", installAiFailure],
    ["IA vazia", installAiEmpty],
    ["itens da IA rejeitados", installAiRejectedItem],
  ])(
    "%s mantém a identidade comercial e falha fechado antes do fallback genérico",
    async (_label, install) => {
      install();

      await expect(
        processMealInput({ text: COMMERCIAL_TEXT })
      ).rejects.toMatchObject({
        code: "food_identity_clarification_required",
        context: expect.objectContaining({
          foodName: "Manteiga Batavo Extra com Sal",
          brand: "Batavo",
          clarificationReason: "brand_variant_unresolved",
          semanticContract: expect.objectContaining({
            needsClarification: true,
            items: [
              expect.objectContaining({
                commercialName: "Manteiga Batavo Extra com Sal",
                brand: "Batavo",
                evidence: expect.objectContaining({
                  nutrition: expect.objectContaining({
                    origin: "heuristic",
                    verified: false,
                    value: expect.objectContaining({
                      calories: 0,
                      protein: 0,
                      carbs: 0,
                      fat: 0,
                    }),
                  }),
                }),
              }),
            ],
          }),
        }),
      });

      expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith(
        "generic_nutrition_fallback",
        expect.anything()
      );
    }
  );

  it("usa a referência comercial verificada e escala a quantidade original de 15 g", async () => {
    installAiFailure();
    findCatalogFoodSemanticMock.mockResolvedValue(verifiedCommercialFood());

    const result = await processMealInput({ text: COMMERCIAL_TEXT });

    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "Manteiga Batavo Extra com Sal",
        brand: "Batavo",
        quantity: 15,
        unit: "g",
        estimatedGrams: 15,
        calories: 105,
        protein: 0.1,
        carbs: 0.2,
        fat: 11.7,
        source: "catalog",
        resolution: expect.objectContaining({
          nutritionOrigin: "web_research",
          nutritionVerified: true,
          sourceUrls: [
            "https://fabricante.example/batavo/manteiga-extra-com-sal",
          ],
          ambiguity: null,
        }),
      }),
    ]);
    expect(result.items[0].calories).not.toBe(22.5);
    expect(result.semanticContract.needsClarification).toBe(false);
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith(
      "generic_nutrition_fallback",
      expect.anything()
    );
    expect(findCatalogFoodSemanticMock).toHaveBeenCalledWith(
      expect.stringMatching(/manteiga Batavo extra com sal/i),
      expect.objectContaining({ searchSpecificProduct: true })
    );
  });

  it("mantém o fallback genérico somente para alimento sem identidade comercial", async () => {
    installAiFailure();

    const result = await processMealInput({
      text: "244g bolo de pote ninho cremoso",
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        foodName: "Bolo de Pote Ninho Cremoso",
        estimatedGrams: 244,
        calories: 366,
        protein: 14.6,
        carbs: 36.6,
        fat: 12.2,
        source: "heuristic",
      })
    );
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith(
      "generic_nutrition_fallback",
      1
    );
  });

  it("bloqueia o lote multi-item antes de createDraft e confirmMeal", async () => {
    installAiFailure();
    const createDraft = vi.fn();
    const confirmMeal = vi.fn();
    const service = createConfirmedMealRegistrationService({
      processMeal: processMealInput,
      getHabits: async () => [],
      createDraft: createDraft as never,
      confirmMeal: confirmMeal as never,
    });

    const result = await service({
      userId: 1088,
      registrationText: "1 pão francês e 15g de manteiga Batavo extra com sal",
      originalText: "1 pão francês e 15g de manteiga Batavo extra com sal",
      occurredAt: NOW,
      userTimezone: "America/Sao_Paulo",
      inboundMessageId: "wamid-1088-regression",
    });

    expect(result.status).toBe("details_needed");
    expect(createDraft).not.toHaveBeenCalled();
    expect(confirmMeal).not.toHaveBeenCalled();
    if (result.status === "details_needed") {
      expect(result.context).toEqual(
        expect.objectContaining({
          brand: "Batavo",
          originalText: expect.stringContaining("15g de manteiga Batavo"),
        })
      );
    }
  });

  it("mantém pão francês resolvido quando o produto comercial do lote é comprovado", async () => {
    installAiFailure();
    findCatalogFoodSemanticMock.mockResolvedValue(verifiedCommercialFood());

    const createDraft = vi.fn(() => ({ draftId: "draft-1088" }));
    const confirmMeal = vi.fn(async (input: { items: unknown[] }) => ({
      id: 1088,
      userId: 1088,
      mealLabel: "Café da manhã",
      occurredAt: NOW.toISOString(),
      items: input.items,
    }));
    const service = createConfirmedMealRegistrationService({
      processMeal: processMealInput,
      getHabits: async () => [],
      createDraft: createDraft as never,
      confirmMeal: confirmMeal as never,
      consolidateMeal: (async (_deps: unknown, meal: unknown) => ({
        action: "created",
        meal,
      })) as never,
      getGoalProgress: async () => undefined,
    });

    const result = await service({
      userId: 1088,
      registrationText: "1 pão francês e 15g de manteiga Batavo extra com sal",
      originalText: "1 pão francês e 15g de manteiga Batavo extra com sal",
      occurredAt: NOW,
      userTimezone: "America/Sao_Paulo",
      inboundMessageId: "wamid-1088-resolved",
    });

    expect(result.status).toBe("registered");
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(confirmMeal).toHaveBeenCalledTimes(1);
    expect(confirmMeal.mock.calls[0]?.[0]?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ foodName: "Pão Francês", calories: 135 }),
        expect.objectContaining({
          foodName: "Manteiga Batavo Extra com Sal",
          quantity: 15,
          calories: 105,
        }),
      ])
    );
  });
});
