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

describe("nutritionEngine low-calorie beverage handling", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));
  });

  it("trata cafe sem acucar por xicara como caloria praticamente nula", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "3 xícaras de café sem açúcar",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Café sem açúcar",
      quantity: 3,
      unit: "xícara",
      portionText: "3 xícara",
      carbs: 0,
      source: "catalog",
    }));
    expect(result.items[0].calories).toBeLessThanOrEqual(2);
    expect(result.totals.calories).toBeLessThanOrEqual(2);
  });

  it("trata cha sem adicao de acucar por copo como caloria praticamente nula", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "2 copos de chá sem adição de açúcar",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Chá sem açúcar",
      quantity: 2,
      unit: "copo",
      portionText: "2 copo",
      carbs: 0,
      source: "catalog",
    }));
    expect(result.items[0].calories).toBeLessThanOrEqual(2);
  });

  it("mantem agua com gas como bebida zero caloria", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "500 ml de água com gás",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Água com gás",
      quantity: 500,
      unit: "ml",
      portionText: "500 ml",
      estimatedGrams: 500,
      calories: 0,
      carbs: 0,
      source: "catalog",
    }));
  });

  it("nao aplica regra zero quando a bebida tem complemento calorico", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café com leite",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].canonicalName).not.toBe("Café sem açúcar");
    expect(result.items[0].calories).toBeGreaterThan(2);
  });
});
