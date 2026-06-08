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

describe("nutritionEngine.processMealInput text fallback", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("usa o texto informado quando a imagem retorna sem itens", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "response-test",
      outputText: JSON.stringify({
        mealLabel: "Bebida",
        confidence: 0.2,
        reasoning: "A imagem não permitiu identificar um item com segurança.",
        items: [],
      }),
      raw: {},
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "200ml guaraná antártica",
      imageUrl: "data:image/png;base64,ZmFrZQ==",
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "guaraná antártica",
        quantity: 200,
        unit: "ml",
        portionText: "200 ml",
        estimatedGrams: 200,
        source: "heuristic",
      }),
    ]);
    expect(result.reasoning).toContain("heurística a partir do texto informado");
  });
});
