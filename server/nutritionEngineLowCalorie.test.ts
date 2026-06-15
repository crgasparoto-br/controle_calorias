import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine low calorie drinks", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));
  });

  it("registra cafe sem acucar sem calorias relevantes por xicara", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "3 xícaras de café sem açúcar" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "café sem açúcar",
      canonicalName: "Café sem açúcar",
      quantity: 3,
      unit: "xícara",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: "catalog",
    }));
    expect(result.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("registra cha sem acucar sem calorias relevantes", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "2 xícaras de chá sem açúcar" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "chá sem açúcar",
      canonicalName: "Chá sem açúcar",
      quantity: 2,
      unit: "xícara",
      calories: 0,
      carbs: 0,
      source: "catalog",
    }));
  });

  it("registra agua com gas como item zero", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "1 copo de água com gás" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "água com gás",
      canonicalName: "Água com gás",
      quantity: 1,
      unit: "copo",
      calories: 0,
      source: "catalog",
    }));
  });

  it("nao zera bebida com complemento calorico", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "1 xícara de café com leite" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].canonicalName).not.toBe("Café sem açúcar");
    expect(result.items[0].calories).toBeGreaterThan(0);
  });
});
