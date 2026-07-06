import { describe, expect, it } from "vitest";
import {
  buildWhatsAppBlock,
  buildWhatsAppFoodLines,
  buildWhatsAppGoalProgressLines,
  buildWhatsAppMealTotalLines,
  buildWhatsAppSeparator,
  buildWhatsAppTitle,
  formatWhatsAppFoodLine,
  formatWhatsAppNutritionTotalsLine,
} from "./replyTemplates";

describe("replyTemplates", () => {
  const banana = {
    foodName: "Banana prata",
    canonicalName: "Banana",
    portionText: "1 unidade",
    estimatedGrams: 80,
    calories: 72,
    protein: 0.9,
    carbs: 18.6,
    fat: 0.2,
    source: "catalog",
  };

  it("centraliza título, separador e blocos de resposta", () => {
    expect(buildWhatsAppTitle("Resumo de hoje:", { bold: true })).toBe("*Resumo de hoje:*");
    expect(buildWhatsAppSeparator()).toBe("");
    expect(buildWhatsAppBlock(["A", buildWhatsAppSeparator(), "B"])).toBe("A\n\nB");
  });

  it("formata alimento com ícone, porção e linha curta de macros de forma reutilizável", () => {
    expect(formatWhatsAppFoodLine(banana)).toBe("• 🍌 Banana prata — 1 unidade (aprox. 80g)");
    expect(buildWhatsAppFoodLines(banana)).toEqual([
      "• 🍌 Banana prata — 1 unidade (aprox. 80g)",
      "72 kcal | P 0,9 g | C 18,6 g | G 0,2 g",
    ]);
  });

  it("formata total da refeição e linha compacta de totais", () => {
    const totals = { calories: 247.5, protein: 46.5, carbs: 0, fat: 5.4 };

    expect(buildWhatsAppMealTotalLines(totals)).toEqual([
      "Total da refeição:",
      "247,5 kcal | P 46,5 g | C 0 g | G 5,4 g",
    ]);
    expect(formatWhatsAppNutritionTotalsLine(totals)).toBe("247,5 kcal | P 46,5 g | C 0 g | G 5,4 g");
  });

  it("formata bloco de meta diária com déficit e exercício", () => {
    expect(buildWhatsAppGoalProgressLines({
      consumedCalories: 1165,
      goalCalories: 2000,
      exerciseCalories: 200,
    })).toEqual([
      "Meta de hoje:",
      "* Meta estimada: 2.000 kcal",
      "* Exercícios: 200 kcal",
      "* Meta ajustada: 2.200 kcal",
      "* Consumo: 1.165 kcal",
      "* Déficit: 1.035 kcal",
    ]);
  });
});
