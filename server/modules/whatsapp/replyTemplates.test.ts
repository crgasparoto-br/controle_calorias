import { describe, expect, it } from "vitest";
import {
  buildWhatsAppBlock,
  buildWhatsAppCalorieBalanceLine,
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

  it("marca como estimado todo item que não veio integralmente do catálogo", () => {
    expect(buildWhatsAppFoodLines({ ...banana, source: undefined })).toEqual([
      "• 🍌 Banana prata — 1 unidade (aprox. 80g)",
      "72 kcal | P 0,9 g | C 18,6 g | G 0,2 g",
      "⚠️ Valores nutricionais estimados pela IA.",
    ]);
    expect(buildWhatsAppFoodLines({ ...banana, source: "hybrid" })).toHaveLength(3);
    expect(buildWhatsAppFoodLines({ ...banana, source: "heuristic" })).toHaveLength(3);
  });

  it("destaca em negrito o total da refeição e seus valores", () => {
    const totals = { calories: 247.5, protein: 46.5, carbs: 0, fat: 5.4 };
    expect(buildWhatsAppMealTotalLines(totals)).toEqual([
      "*Total da refeição:*",
      "*247,5 kcal | P 46,5 g | C 0 g | G 5,4 g*",
    ]);
    expect(formatWhatsAppNutritionTotalsLine(totals)).toBe("247,5 kcal | P 46,5 g | C 0 g | G 5,4 g");
  });

  it("separa consumo e déficit usando a meta efetiva", () => {
    expect(buildWhatsAppGoalProgressLines({
      consumedCalories: 1850,
      effectiveGoalCalories: 2000,
      exerciseCalories: 350,
    })).toEqual([
      "*Meta:* 2.000 kcal",
      "*Exercícios:* 350 kcal",
      "*Consumo:* 1.850 kcal",
      "*Déficit:* 150 kcal (-7%)",
    ]);
  });

  it("aceita temporariamente o alias legado contendo a meta efetiva", () => {
    expect(buildWhatsAppGoalProgressLines({
      consumedCalories: 2100,
      goalCalories: 2000,
    })).toEqual([
      "*Meta:* 2.000 kcal",
      "*Consumo:* 2.100 kcal",
      "*Superávit:* 100 kcal (+5%)",
    ]);
  });

  it("nunca usa o rótulo composto de saldo", () => {
    const lines = buildWhatsAppGoalProgressLines({
      consumedCalories: 2100,
      effectiveGoalCalories: 2000,
    });

    expect(lines.join("\n")).not.toContain("Superávit/Déficit");
  });

  it("normaliza os valores exibidos antes de classificar equilíbrio", () => {
    expect(buildWhatsAppCalorieBalanceLine({
      consumedCalories: 2000.4,
      effectiveGoalCalories: 2000.49,
      precision: 0,
    })).toBe("*Equilíbrio:* 0 kcal (0%)");
  });

  it("inclui consumo, diferença e percentual de macronutrientes", () => {
    expect(buildWhatsAppGoalProgressLines({
      consumedCalories: 1850,
      effectiveGoalCalories: 2000,
      consumedProteinGrams: 110,
      targetProteinGrams: 120,
      consumedCarbsGrams: 130,
      targetCarbsGrams: 150,
      consumedFatGrams: 55,
      targetFatGrams: 50,
    })).toEqual([
      "*Meta:* 2.000 kcal",
      "*Consumo:* 1.850 kcal",
      "*Déficit:* 150 kcal (-7%)",
      "",
      "*Macronutrientes*",
      "• P 110 g (-10 g/-8%)",
      "• C 130 g (-20 g/-13%)",
      "• G 55 g (+5 g/+10%)",
    ]);
  });

  it("omite somente o macro cuja meta esteja ausente ou inválida", () => {
    expect(buildWhatsAppGoalProgressLines({
      consumedCalories: 2000,
      effectiveGoalCalories: 2000,
      consumedProteinGrams: 100,
      targetProteinGrams: 0,
      consumedCarbsGrams: 150,
      targetCarbsGrams: 150,
    })).toEqual([
      "*Meta:* 2.000 kcal",
      "*Consumo:* 2.000 kcal",
      "*Equilíbrio:* 0 kcal (0%)",
      "",
      "*Macronutrientes*",
      "• C 150 g (0 g/0%)",
    ]);
  });
});
