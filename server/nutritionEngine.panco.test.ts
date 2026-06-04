import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine Panco bisnaguinha catalog support", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("reconhece 1 bisnaguinha Panco como item de catálogo com porção unitária", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 bisnaguinha panco",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "1 bisnaguinha panco",
      canonicalName: "Bisnaguinha Panco",
      portionText: "1 unidade",
      estimatedGrams: 20,
      calories: 62,
      protein: 1.8,
      carbs: 12,
      fat: 0.9,
      source: "catalog",
    }));
    expect(result.totals).toEqual({
      calories: 62,
      protein: 1.8,
      carbs: 12,
      fat: 0.9,
    });
  });
});
