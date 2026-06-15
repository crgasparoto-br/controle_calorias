import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlineNutritionSourceCandidate } from "./nutritionOnlineSource";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine source metadata", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("anexa fonte nutricional curada a item vindo do catalogo", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "Coca-Cola zero lata" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Coca-Cola zero lata",
      source: "catalog",
      nutritionSource: expect.objectContaining({
        quality: "exact",
        isEstimate: false,
        reviewRequired: false,
        source: expect.objectContaining({
          type: "curated_catalog",
          name: "Catálogo interno",
          version: "static-reference",
        }),
      }),
    }));
  });

  it("usa candidato online aceito para substituir estimativa com fonte rastreavel", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const onlineCandidate: OnlineNutritionSourceCandidate = {
      id: "fizzup-zero-manufacturer-label",
      name: "FizzUp zero lata 350 ml",
      brandName: "FizzUp",
      variation: "zero",
      originType: "manufacturer",
      sourceName: "FizzUp Brasil",
      sourceUrl: "https://www.fizzup.example/produtos/fizzup-zero-lata",
      sourceVersion: "2026-06",
      queriedAt: "2026-06-15T12:00:00.000Z",
      confidence: 0.97,
      serving: {
        quantity: 1,
        unit: "lata",
        text: "1 lata (350 ml)",
      },
      nutritionPerServing: {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
      aliases: ["fizzup zero", "fizzup zero lata"],
    };

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "FizzUp zero lata",
      onlineNutritionSourceCandidates: [onlineCandidate],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "FizzUp zero lata 350 ml",
      source: "catalog",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      nutritionSource: expect.objectContaining({
        selectedAt: "2026-06-15T12:00:00.000Z",
        quality: "exact",
        isEstimate: false,
        reviewRequired: false,
        source: expect.objectContaining({
          type: "manufacturer_label",
          name: "FizzUp Brasil",
          version: "2026-06",
        }),
      }),
    }));
    expect(result.totals.calories).toBe(0);
  });

  it("marca estimativa da IA como fonte estimada quando usa macros inferidos", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_hybrid_source",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.82,
        reasoning: "Alimento sem correspondência no catálogo, com estimativa nutricional.",
        items: [
          {
            foodName: "creme proteico artesanal",
            quantity: 1,
            unit: "porção",
            portionText: "1 porção",
            servings: 1,
            estimatedGrams: 120,
            estimatedCalories: 180,
            estimatedMacros: { protein: 18, carbs: 12, fat: 7 },
            confidence: 0.7,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "creme proteico artesanal" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "creme proteico artesanal",
      source: "hybrid",
      nutritionSource: expect.objectContaining({
        quality: "estimated",
        isEstimate: true,
        reviewRequired: true,
        source: expect.objectContaining({
          type: "llm_estimate",
          name: "Estimativa da IA",
        }),
      }),
    }));
  });

  it("marca fallback heuristico como estimativa rastreavel", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "porção de comida desconhecida" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      source: "heuristic",
      nutritionSource: expect.objectContaining({
        quality: "estimated",
        isEstimate: true,
        reviewRequired: true,
        source: expect.objectContaining({
          type: "generic_estimate",
          name: "Estimativa por regra interna",
        }),
      }),
    }));
  });
});
