import { describe, expect, it } from "vitest";
import { formatFoodNameTitleCase, normalizeLlmItem } from "./mealTextParsing";
import { buildHeuristicItem, buildHybridItem } from "./mealItemBuilders";
import type { LlmItem } from "./nutritionEngineTypes";

function llmItem(foodName: string, overrides: Partial<LlmItem> = {}): LlmItem {
  return {
    foodName,
    quantity: overrides.quantity,
    unit: overrides.unit,
    portionText: overrides.portionText ?? "1 porção",
    servings: overrides.servings ?? 1,
    estimatedGrams: overrides.estimatedGrams ?? 100,
    estimatedCalories: overrides.estimatedCalories ?? 150,
    estimatedMacros: overrides.estimatedMacros ?? { protein: 6, carbs: 15, fat: 5 },
    confidence: overrides.confidence ?? 0.7,
    foodClassification: overrides.foodClassification,
  };
}

describe("food name title case normalization", () => {
  it("padroniza nomes de alimentos em title case pt-BR", () => {
    expect(formatFoodNameTitleCase("whey proten doce de leite")).toBe("Whey Proten Doce de Leite");
    expect(formatFoodNameTitleCase("Whey proten")).toBe("Whey Proten");
    expect(formatFoodNameTitleCase("whey Proten")).toBe("Whey Proten");
    expect(formatFoodNameTitleCase("doce de leite")).toBe("Doce de Leite");
    expect(formatFoodNameTitleCase("pão com mel")).toBe("Pão com Mel");
    expect(formatFoodNameTitleCase("iogurte grego light")).toBe("Iogurte Grego Light");
  });

  it("mantem conectores minusculos apenas no meio do nome", () => {
    expect(formatFoodNameTitleCase("de leite com mel")).toBe("De Leite com Mel");
    expect(formatFoodNameTitleCase("arroz e feijão")).toBe("Arroz e Feijão");
    expect(formatFoodNameTitleCase("macarrão ao sugo")).toBe("Macarrão ao Sugo");
    expect(formatFoodNameTitleCase("vitamina para treino")).toBe("Vitamina para Treino");
  });

  it("preserva acentos, siglas e palavras com hifen", () => {
    expect(formatFoodNameTitleCase("pêra william")).toBe("Pêra William");
    expect(formatFoodNameTitleCase("chá-mate zero")).toBe("Chá-Mate Zero");
    expect(formatFoodNameTitleCase("BCAA em pó")).toBe("BCAA em Pó");
  });

  it("normaliza apenas o nome extraido sem alterar quantidade, unidade ou porcao", () => {
    const item = normalizeLlmItem(llmItem("18g whey proten doce de leite", {
      quantity: 1,
      unit: "porção",
      portionText: "1 porção",
      estimatedGrams: 0,
    }));

    expect(item).toEqual(expect.objectContaining({
      foodName: "Whey Proten Doce de Leite",
      quantity: 18,
      unit: "g",
      portionText: "18 g",
      estimatedGrams: 18,
    }));
  });

  it("aplica padronizacao nos itens hibridos e heuristicos gravados pelo fluxo", () => {
    const hybrid = buildHybridItem(llmItem("whey Proten doce de leite", { estimatedGrams: 18 }));
    const heuristic = buildHeuristicItem("100g pão com mel");

    expect(hybrid).toEqual(expect.objectContaining({
      foodName: "Whey Proten Doce de Leite",
      canonicalName: "Whey Proten Doce de Leite",
      estimatedGrams: 18,
    }));
    expect(heuristic).toEqual(expect.objectContaining({
      foodName: "Pão com Mel",
      canonicalName: "Pão com Mel",
      quantity: 100,
      unit: "g",
      portionText: "100 g",
      estimatedGrams: 100,
    }));
  });
});
