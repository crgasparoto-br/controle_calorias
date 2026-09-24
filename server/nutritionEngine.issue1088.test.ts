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

function installAiLowConfidenceCommercialItem() {
  createTextResponseMock.mockResolvedValue({
    id: "response-low-confidence-commercial-1088",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.8,
      reasoning: "Item identificado com baixa confiança.",
      items: [
        {
          foodName: "manteiga",
          brand: null,
          quantity: 15,
          unit: "g",
          portionText: "15 g",
          servings: 0.15,
          estimatedGrams: 15,
          estimatedCalories: 22.5,
          estimatedMacros: { protein: 0.9, carbs: 2.25, fat: 0.75 },
          confidence: 0.2,
          foodClassification: {
            processingLevel: "processed_culinary_ingredient",
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
    expect(
      inferUnresolvedCommercialIdentityHint("manteiga Koala-extra com sal")
    ).toEqual({
      brand: "Koala",
      productVariant: null,
    });
  });

  it.each([
    "manteiga com sal",
    "manteiga de amendoim",
    "manteiga de cacau",
    "manteiga de alho",
    "iogurte natural",
    "iogurte grego",
    "iogurte proteico",
    "iogurte cremoso",
    "queijo frescal",
    "pão sovado",
    "água tônica",
    "pão e manteiga",
    "manteiga sabor chocolate",
    "queijo mussarela",
    "queijo de cabra",
    "carne moída suína",
    "iogurte de baunilha",
    "iogurte sabor baunilha",
    "refrigerante de laranja",
    "pão multigrãos",
    "manteiga premium",
    "ZERO AÇÚCAR ÁGUA TÔNICA",
    "Iogurte sabor refrigerante zero açúcar",
    "batata-doce assada em rodelas",
  ])("não promove descrição genérica a marca desconhecida: %s", foodName => {
    expect(inferUnresolvedCommercialIdentityHint(foodName)).toBeNull();
  });

  it.each([
    "batata-doce assada em rodelas",
    "batata doce cozida picada",
    "cenoura grelhada fatiada",
  ])("não promove preparo ou apresentação a marca desconhecida: %s", foodName => {
    expect(inferUnresolvedCommercialIdentityHint(foodName)).toBeNull();
  });

  it.each([
    "iogurte grego",
    "iogurte proteico",
    "iogurte cremoso",
    "manteiga de amendoim",
    "manteiga de cacau",
    "manteiga de alho",
  ])(
    "mantém qualificador genérico no pipeline real sem bloquear o fallback: %s",
    async foodName => {
      installAiFailure();

      const result = await processMealInput({ text: foodName });
      const item = result.items[0];

      expect(item).toEqual(
        expect.objectContaining({
          foodName: expect.stringMatching(new RegExp(foodName, "i")),
          brand: null,
          source: "heuristic",
        })
      );
      expect(item.calories).toBe(150);
      expect(result.semanticContract).toEqual(
        expect.objectContaining({
          needsClarification: false,
          items: [
            expect.objectContaining({
              brand: null,
              needsClarification: false,
              evidence: expect.objectContaining({
                nutrition: expect.objectContaining({
                  origin: "heuristic",
                  verified: false,
                  value: expect.objectContaining({
                    calories: 150,
                    protein: 6,
                    carbs: 15,
                    fat: 5,
                  }),
                }),
              }),
            }),
          ],
        })
      );
      expect(logMealInferenceFallbackMock).toHaveBeenCalledWith(
        "generic_nutrition_fallback",
        1
      );
    }
  );

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
      expect(logMealInferenceFallbackMock).toHaveBeenCalledWith(
        "catalog_miss",
        expect.any(Number)
      );
    }
  );

  it("preserva a clarificação comercial quando a IA retorna o item com baixa confiança", async () => {
    installAiLowConfidenceCommercialItem();

    await expect(
      processMealInput({ text: COMMERCIAL_TEXT })
    ).rejects.toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({
        foodName: expect.stringMatching(/Manteiga Batavo Extra com Sal/i),
        brand: "Batavo",
        clarificationReason: "brand_variant_unresolved",
      }),
    });

    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith(
      "generic_nutrition_fallback",
      expect.anything()
    );
  });

  it("preserva marca desconhecida com conector de posse", async () => {
    installAiFailure();

    await expect(
      processMealInput({ text: "15g de manteiga da Batavo extra com sal" })
    ).rejects.toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({
        foodName: "Manteiga da Batavo Extra com Sal",
        brand: "Batavo",
        clarificationReason: "brand_variant_unresolved",
      }),
    });

    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith(
      "generic_nutrition_fallback",
      expect.anything()
    );
  });

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
      expect.stringMatching(/15\s*g\s+de\s+manteiga Batavo extra com sal/i),
      expect.objectContaining({ searchSpecificProduct: true })
    );
  });

  it("recupera a marca do foodName da imagem e aciona a busca específica", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "response-image-commercial-1088",
      outputText: JSON.stringify({
        mealLabel: "Café da manhã",
        confidence: 0.9,
        reasoning: "Produto comercial identificado visualmente.",
        items: [
          {
            foodName: "Manteiga Batavo Extra com Sal",
            brand: null,
            quantity: 20,
            unit: "g",
            portionText: "20 g",
            servings: 0.2,
            estimatedGrams: 20,
            estimatedCalories: 30,
            estimatedMacros: { protein: 1.2, carbs: 3, fat: 1 },
            confidence: 0.82,
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
    findCatalogFoodSemanticMock.mockResolvedValue(verifiedCommercialFood());

    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,meal-image",
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        foodName: "Manteiga Batavo Extra com Sal",
        brand: "Batavo",
        calories: 140,
        protein: 0.1,
        carbs: 0.2,
        fat: 15.6,
        source: "catalog",
        resolution: expect.objectContaining({
          nutritionOrigin: "web_research",
          nutritionVerified: true,
        }),
      })
    );
    expect(findCatalogFoodSemanticMock).toHaveBeenCalledWith(
      expect.stringMatching(/Manteiga Batavo Extra com Sal/i),
      expect.objectContaining({ searchSpecificProduct: true })
    );
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith(
      "generic_nutrition_fallback",
      expect.anything()
    );
  });

  it("preserva todos os itens distintos de uma única imagem", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "response-image-multi-item-1177",
      outputText: JSON.stringify({
        mealLabel: "Almoço",
        confidence: 0.91,
        reasoning: "Dois itens visíveis na mesma refeição.",
        items: [
          {
            foodName: "arroz",
            brand: null,
            quantity: 100,
            unit: "g",
            portionText: "100 g",
            servings: 1,
            estimatedGrams: 100,
            estimatedCalories: 130,
            estimatedMacros: { protein: 2.7, carbs: 28, fat: 0.3 },
            confidence: 0.92,
            foodClassification: {
              processingLevel: "natural_or_minimally_processed",
              isFruit: false,
              isVegetable: false,
              fiberGrams: 1.5,
              isPlainWater: false,
            },
          },
          {
            foodName: "feijão",
            brand: null,
            quantity: 100,
            unit: "g",
            portionText: "100 g",
            servings: 1,
            estimatedGrams: 100,
            estimatedCalories: 76,
            estimatedMacros: { protein: 4.8, carbs: 13.6, fat: 0.5 },
            confidence: 0.9,
            foodClassification: {
              processingLevel: "natural_or_minimally_processed",
              isFruit: false,
              isVegetable: false,
              fiberGrams: 4.5,
              isPlainWater: false,
            },
          },
        ],
      }),
      raw: {},
    });

    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,multi-item-image",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.map(item => item.foodName)).toEqual([
      "Arroz",
      "Feijão",
    ]);
    expect(result.semanticContract.items).toHaveLength(2);
    expect(result.semanticContract.clarifications).toEqual([]);
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
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith(
      "catalog_miss",
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

  it("mantém uma segunda marca desconhecida no pipeline real até o boundary de registro", async () => {
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
      registrationText: "15g de manteiga Koala extra com sal",
      originalText: "15g de manteiga Koala extra com sal",
      occurredAt: NOW,
      userTimezone: "America/Sao_Paulo",
      inboundMessageId: "wamid-1088-koala",
    });

    expect(result.status).toBe("details_needed");
    expect(createDraft).not.toHaveBeenCalled();
    expect(confirmMeal).not.toHaveBeenCalled();
    if (result.status === "details_needed") {
      expect(result.context).toEqual(
        expect.objectContaining({
          brand: "Koala",
          originalText: expect.stringContaining("15g de manteiga Koala"),
        })
      );
    }
  });

  it("bloqueia marca hifenizada antes do fallback nutricional genérico", async () => {
    installAiFailure();

    await expect(
      processMealInput({ text: "15g de manteiga Koala-extra com sal" })
    ).rejects.toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({
        brand: "Koala",
        foodName: expect.stringMatching(/Manteiga Koala-?Extra com Sal/i),
      }),
    });

    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith(
      "generic_nutrition_fallback",
      expect.anything()
    );
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
