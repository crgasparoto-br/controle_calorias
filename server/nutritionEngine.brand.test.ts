import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: vi.fn(async () => null),
}));

describe("nutritionEngine branded catalog selection", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));
  });

  it("reconhece marca no meio da frase e prioriza produto especifico", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "comi um iogurte Nestlé natural 170g",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "comi um iogurte Nestlé natural",
      canonicalName: "Iogurte natural Nestlé",
      brand: "Nestlé",
      portionText: "170 g",
      estimatedGrams: 170,
      calories: 108,
      source: "catalog",
    }));
  });

  it("preserva variacao zero e nao troca por produto tradicional", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "Coca-Cola zero lata",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Coca-Cola zero lata",
      brand: "Coca-Cola",
      portionText: "1 lata",
      calories: 0,
      carbs: 0,
      source: "catalog",
    }));
  });

  it("usa generico como aproximacao quando a marca nao existe no catalogo", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "iogurte Danone natural 170g",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Iogurte natural integral",
      brand: "Danone",
      portionText: "170 g",
      source: "heuristic",
    }));
    expect(result.items[0].confidence).toBeLessThanOrEqual(0.62);
  });

  it("mantem fluxo generico para alimento sem marca", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "iogurte natural 170g",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Iogurte natural integral",
      brand: null,
      portionText: "170 g",
      source: "catalog",
    }));
  });
});
