import { beforeEach, describe, expect, it, vi } from "vitest";

const extractWithAiMock = vi.fn();
const findCatalogFoodMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();
const getCatalogCacheMock = vi.fn();

vi.mock("./mealAiExtraction", () => ({
  extractWithAi: (...args: unknown[]) => extractWithAiMock(...args),
}));

vi.mock("./catalogMatching", async importOriginal => {
  const actual = await importOriginal<typeof import("./catalogMatching")>();
  return {
    ...actual,
    findCatalogFood: (...args: unknown[]) => findCatalogFoodMock(...args),
    isCatalogFoodSemanticallyCompatible: () => true,
    sourceMentionsFood: () => true,
  };
});

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => findCatalogFoodSemanticMock(...args),
}));

vi.mock("./catalogRuntime", () => ({
  getCatalogCache: () => getCatalogCacheMock(),
}));

vi.mock("./tacoLookup", () => ({
  findTacoFood: () => undefined,
}));

const { MealInferenceError, processMealInput } = await import("./nutritionEngine");

const baseClassification = {
  processingLevel: "processed" as const,
  isFruit: false,
  isVegetable: false,
  fiberGrams: 1.2,
  isPlainWater: false,
};

function extraction(input: {
  foodName?: string;
  brand?: string | null;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  reasoning?: string;
} = {}) {
  return {
    mealLabel: "Café da manhã",
    confidence: 0.94,
    reasoning: input.reasoning ?? "Produto reconhecido por marca e descrição.",
    items: [{
      foodName: input.foodName ?? "pão de forma",
      brand: input.brand === undefined ? "Panco" : input.brand,
      quantity: 2,
      unit: "fatia",
      portionText: "2 fatias",
      servings: 1,
      estimatedGrams: 50,
      estimatedCalories: input.calories ?? 125,
      estimatedMacros: {
        protein: input.protein ?? 3.9,
        carbs: input.carbs ?? 24,
        fat: input.fat ?? 1.5,
      },
      confidence: 0.94,
      foodClassification: baseClassification,
    }],
  };
}

const premium = {
  slug: "web-nutrition-panco-premium",
  name: "Pão de Forma Panco Premium",
  aliases: ["Panco Premium", "Pão de Forma Panco Premium"],
  servingLabel: "2 fatias (50 g)",
  gramsPerServing: 50,
  calories: 125,
  protein: 3.9,
  carbs: 24,
  fat: 1.5,
  brandName: "Panco",
  productVariant: "premium",
  variants: ["Pão de Forma Panco Premium"],
  researchIdentityKey: "nutrition-research-v1:premium",
  sourceUrls: ["https://panco.example/premium"],
  sourceEvidence: "2 fatias (50 g): 125 kcal, 3,9 g proteínas, 24 g carboidratos e 1,5 g gorduras.",
  sourceVerifiedAt: new Date("2026-09-06T09:00:00.000Z"),
  sourceConfidence: 0.95,
  isBrandedProduct: true,
};

const integral = {
  ...premium,
  slug: "web-nutrition-panco-integral",
  name: "Pão de Forma Panco Integral",
  aliases: ["Panco Integral", "Pão de Forma Panco Integral"],
  calories: 137,
  protein: 5.5,
  carbs: 21,
  fat: 1.7,
  productVariant: "integral",
  variants: ["Pão de Forma Panco Integral"],
  researchIdentityKey: "nutrition-research-v1:integral",
  sourceUrls: ["https://panco.example/integral"],
};

beforeEach(() => {
  extractWithAiMock.mockReset();
  findCatalogFoodMock.mockReset();
  findCatalogFoodSemanticMock.mockReset();
  getCatalogCacheMock.mockReset();
  findCatalogFoodMock.mockReturnValue(undefined);
  findCatalogFoodSemanticMock.mockResolvedValue(null);
  getCatalogCacheMock.mockReturnValue([]);
});

describe("issue #1051 — contrato semântico e fail-closed de marca", () => {
  it("bloqueia macros estimados pela IA quando Panco não tem variante comprovada", async () => {
    extractWithAiMock.mockResolvedValue(extraction());
    getCatalogCacheMock.mockReturnValue([premium, integral]);

    let captured: unknown;
    try {
      await processMealInput({ text: "2 fatias de pão de forma Panco" });
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(MealInferenceError);
    expect(captured).toMatchObject({
      code: "food_identity_clarification_required",
      context: {
        brand: "Panco",
        clarificationReason: "brand_variant_unresolved",
        alternatives: [
          expect.objectContaining({ name: "Pão de Forma Panco Premium", productVariant: "premium" }),
          expect.objectContaining({ name: "Pão de Forma Panco Integral", productVariant: "integral" }),
        ],
        semanticContract: {
          needsClarification: true,
          clarifications: [
            expect.objectContaining({ code: "brand_variant_unresolved" }),
          ],
          items: [
            expect.objectContaining({
              brand: "Panco",
              productVariant: null,
              needsClarification: true,
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
        },
      },
    });
  });

  it("aceita macros da imagem sem catálogo somente quando variante e tabela nutricional estão explícitas", async () => {
    extractWithAiMock.mockResolvedValue(extraction({
      foodName: "Pão de Forma Panco Premium",
      reasoning: "A tabela nutricional legível da embalagem informa os valores usados.",
    }));

    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,aW1hZ2Vt",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Pão de Forma Panco Premium",
      brand: "Panco",
      calories: 125,
      source: "hybrid",
    }));
    expect(result.semanticContract).toMatchObject({
      inputType: "image",
      needsClarification: false,
      items: [
        expect.objectContaining({
          brand: "Panco",
          productVariant: "premium",
          evidence: expect.objectContaining({
            nutrition: expect.objectContaining({
              origin: "nutrition_label",
              verified: true,
            }),
          }),
        }),
      ],
    });
  });

  it("projeta a mesma identidade comercial em texto, transcrição e imagem", async () => {
    findCatalogFoodSemanticMock.mockResolvedValue(premium);
    getCatalogCacheMock.mockReturnValue([premium, integral]);

    extractWithAiMock.mockResolvedValue(extraction({ foodName: "Pão de Forma Panco Premium" }));
    const text = await processMealInput({ text: "2 fatias de pão de forma Panco Premium" });

    extractWithAiMock.mockResolvedValue(extraction({ foodName: "Pão de Forma Panco Premium" }));
    const audio = await processMealInput({
      transcript: "2 fatias de pão de forma Panco Premium",
      audioUrl: "https://media.example/audio.ogg",
    });

    extractWithAiMock.mockResolvedValue(extraction({ foodName: "Pão de Forma Panco Premium" }));
    const image = await processMealInput({
      imageUrl: "data:image/jpeg;base64,aW1hZ2Vt",
    });

    const identity = (result: typeof text) => {
      const item = result.semanticContract.items[0];
      return {
        commercialName: item.commercialName,
        brand: item.brand,
        productVariant: item.productVariant,
        quantity: item.quantity,
        unit: item.unit,
        estimatedGrams: item.estimatedGrams,
        needsClarification: item.needsClarification,
        nutritionOrigin: item.evidence.nutrition.origin,
        nutritionVerified: item.evidence.nutrition.verified,
      };
    };

    expect(text.semanticContract.inputType).toBe("text");
    expect(audio.semanticContract.inputType).toBe("audio_transcript");
    expect(image.semanticContract.inputType).toBe("image");
    expect(identity(audio)).toEqual(identity(text));
    expect(identity(image)).toEqual(identity(text));
    expect(identity(text)).toEqual(expect.objectContaining({
      commercialName: "Pão de Forma Panco Premium",
      brand: "Panco",
      productVariant: "premium",
      nutritionOrigin: "web_research",
      nutritionVerified: true,
      needsClarification: false,
    }));
  });
});
