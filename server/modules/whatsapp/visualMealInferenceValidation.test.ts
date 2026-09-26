import { describe, expect, it } from "vitest";
import type { MealDraftItem } from "../../nutritionEngine";
import {
  inspectWhatsappImageMealItemsPersistence,
  resolveWhatsappImageVisibleFoodName,
} from "./visualMealInferenceValidation";

function item(overrides: Partial<MealDraftItem> = {}): MealDraftItem {
  return {
    foodName: "Banana prata",
    canonicalName: "Banana prata",
    portionText: "30 g",
    quantity: 30,
    unit: "g",
    servings: 1,
    estimatedGrams: 30,
    calories: 27,
    protein: 0.4,
    carbs: 7,
    fat: 0.1,
    confidence: 0.9,
    source: "heuristic",
    ...overrides,
  };
}

describe("visualMealInferenceValidation", () => {
  it.each([
    "não identificado",
    "desconhecido",
    "desconhecida",
    "item 1",
    "alimento desconhecido",
    "sem identificação",
    "não foi possível identificar o alimento",
    "sem alimento reconhecido",
  ])("rejeita marcador genérico de identidade: %s", foodName => {
    const candidate = item({ foodName, canonicalName: foodName });

    expect(resolveWhatsappImageVisibleFoodName(candidate)).toBeNull();
    expect(inspectWhatsappImageMealItemsPersistence([candidate])).toEqual({
      status: "missing_identity",
      itemIndexes: [0],
    });
  });

  it("preserva os itens confiáveis e aponta somente a identidade ausente", () => {
    const inspection = inspectWhatsappImageMealItemsPersistence([
      item({ foodName: "Cerveja Lager", canonicalName: "Cerveja Lager" }),
      item({ foodName: "item 2", canonicalName: "item 2" }),
      item({ foodName: "Batata assada", canonicalName: "Batata assada" }),
    ]);

    expect(inspection).toEqual({
      status: "missing_identity",
      itemIndexes: [1],
    });
  });

  it("mantém a ausência global quando nenhum item é reconhecível", () => {
    expect(inspectWhatsappImageMealItemsPersistence([])).toEqual({
      status: "missing_identity",
      itemIndexes: [],
    });
  });

  it("não aceita estimatedGrams isolado como porção segura", () => {
    const candidate = item({
      quantity: undefined,
      unit: undefined,
      portionText: "porção não informada",
      estimatedGrams: 100,
    });

    expect(inspectWhatsappImageMealItemsPersistence([candidate])).toEqual(
      expect.objectContaining({ status: "missing_portion", itemIndex: 0 })
    );
  });

  it("não aceita porção heurística aproximada como quantidade explícita", () => {
    const candidate = item({
      quantity: 1,
      unit: "porção",
      portionText: "1 porção (aprox. 100g)",
      estimatedGrams: 100,
    });

    expect(inspectWhatsappImageMealItemsPersistence([candidate])).toEqual(
      expect.objectContaining({ status: "missing_portion", itemIndex: 0 })
    );
  });

  it("não aceita uma porção heurística genérica sem base canônica", () => {
    const candidate = item({
      quantity: 1,
      unit: "porção",
      portionText: "1 porção",
      estimatedGrams: 100,
      source: "heuristic",
    });

    expect(inspectWhatsappImageMealItemsPersistence([candidate])).toEqual(
      expect.objectContaining({ status: "missing_portion", itemIndex: 0 })
    );
  });

  it("mantém persistível uma quantidade explícita com unidade", () => {
    expect(inspectWhatsappImageMealItemsPersistence([item()])).toEqual({
      status: "persistable",
    });
  });
});
