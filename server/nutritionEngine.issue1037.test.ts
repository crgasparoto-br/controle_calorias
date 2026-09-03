import { beforeEach, describe, expect, it, vi } from "vitest";
import { findTacoFood } from "./tacoLookup";

const createTextResponseMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();

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

function genericInferenceItem(foodName: string, grams: number) {
  return {
    foodName,
    portionText: `${grams} g`,
    servings: 1,
    estimatedGrams: grams,
    estimatedCalories: 150,
    estimatedMacros: {
      protein: 6,
      carbs: 15,
      fat: 5,
    },
    confidence: 0.9,
    foodClassification: {
      processingLevel: "processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 0,
    },
  };
}

describe("issue #1037 — gramatura resolvida no motor nutricional", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(undefined);
  });

  it("calcula presunto e mussarela pela gramatura encaminhada e não pelo perfil genérico 150/6/15/5", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_issue_1037",
      outputText: JSON.stringify({
        mealLabel: "Café da manhã",
        confidence: 0.95,
        reasoning: "Fixture determinística da regressão #1037.",
        items: [
          genericInferenceItem("presunto sem capa de gordura", 60),
          genericInferenceItem("queijo mussarela", 41),
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "60 g de presunto sem capa de gordura, 41 g de queijo mussarela",
      occurredAt: "2026-09-02T08:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    const presuntoRef = findTacoFood("presunto sem capa de gordura");
    const mussarelaRef = findTacoFood("queijo mussarela");
    expect(presuntoRef).toBeDefined();
    expect(mussarelaRef).toBeDefined();

    const presunto = result.items.find(item => /presunto/i.test(item.foodName));
    const mussarela = result.items.find(item => /mussarela|mozarela/i.test(`${item.foodName} ${item.canonicalName}`));
    expect(presunto).toBeDefined();
    expect(mussarela).toBeDefined();

    const round1 = (value: number) => Math.round(value * 10) / 10;
    expect(presunto).toEqual(expect.objectContaining({
      estimatedGrams: 60,
      calories: round1((presuntoRef!.calories * 60) / presuntoRef!.gramsPerServing),
      protein: round1((presuntoRef!.protein * 60) / presuntoRef!.gramsPerServing),
      carbs: round1((presuntoRef!.carbs * 60) / presuntoRef!.gramsPerServing),
      fat: round1((presuntoRef!.fat * 60) / presuntoRef!.gramsPerServing),
      source: "catalog",
    }));
    expect(mussarela).toEqual(expect.objectContaining({
      estimatedGrams: 41,
      calories: round1((mussarelaRef!.calories * 41) / mussarelaRef!.gramsPerServing),
      protein: round1((mussarelaRef!.protein * 41) / mussarelaRef!.gramsPerServing),
      carbs: round1((mussarelaRef!.carbs * 41) / mussarelaRef!.gramsPerServing),
      fat: round1((mussarelaRef!.fat * 41) / mussarelaRef!.gramsPerServing),
      source: "catalog",
    }));

    expect([presunto!.calories, presunto!.protein, presunto!.carbs, presunto!.fat]).not.toEqual([150, 6, 15, 5]);
    expect([mussarela!.calories, mussarela!.protein, mussarela!.carbs, mussarela!.fat]).not.toEqual([150, 6, 15, 5]);
  });
});
