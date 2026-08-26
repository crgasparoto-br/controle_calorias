import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

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
  findCatalogFoodSemantic: vi.fn(async () => null),
}));

describe("nutritionEngine preserva refeições compostas com café adoçado", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));
  });

  it("mantém café com açúcar e café sem açúcar como dois itens distintos", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café com 5 g de açúcar e 1 xícara de café sem açúcar",
    });

    expect(result.items).toHaveLength(2);
    const sweetened = result.items.find(item => item.canonicalName === "Café com açúcar");
    const unsweetened = result.items.find(item => /sem açúcar/i.test(item.canonicalName));

    expect(sweetened).toEqual(expect.objectContaining({
      estimatedGrams: 205,
      calories: 22,
      carbs: 5,
    }));
    expect(unsweetened).toEqual(expect.objectContaining({
      calories: expect.any(Number),
      carbs: 0,
    }));
    expect(unsweetened!.calories).toBeLessThanOrEqual(2);
  });

  it("não descarta alimentos companheiros quando o açúcar está explícito", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 pão francês e 1 xícara de café com 5 g de açúcar",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.some(item => /pão francês/i.test(item.foodName))).toBe(true);
    expect(result.items.find(item => item.canonicalName === "Café com açúcar")).toEqual(
      expect.objectContaining({ calories: 22, carbs: 5 }),
    );
  });

  it("aplica a regra simples somente ao segmento de café e preserva o açúcar explícito de outro alimento", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café com açúcar e 1 fatia de bolo com 10 g de açúcar",
    });

    const coffee = result.items.find(item => item.canonicalName === "Café com açúcar");
    const cake = result.items.find(item => /bolo/i.test(`${item.foodName} ${item.canonicalName}`));
    expect(coffee).toEqual(expect.objectContaining({ calories: 22, carbs: 5 }));
    expect(coffee?.portionText).toMatch(/estimado 5 g/i);
    expect(cake).toBeTruthy();
  });
});
