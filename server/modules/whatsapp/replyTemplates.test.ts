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

  it("marca como estimado todo item que não veio integralmente do catálogo", () => {
    expect(buildWhatsAppFoodLines({ ...banana, source: undefined })).toEqual([
      "• 🍌 Banana prata — 1 unidade (aprox. 80g)",
      "72 kcal | P 0,9 g | C 18,6 g | G 0,2 g",
      "⚠️ Valores nutricionais estimados pela IA.",
    ]);
    expect(buildWhatsAppFoodLines({ ...banana, source: "hybrid" })).toHaveLength(3);
    expect(buildWhatsAppFoodLines({ ...banana, source: "heuristic" })).toHaveLength(3);
  });

  it("formata total da refeição e linha compacta de totais", () => {
    const totals = { calories: 247.5, protein: 46.5, carbs: 0, fat: 5.4 };

    expect(buildWhatsAppMealTotalLines(totals)).toEqual([
      "*Total da refeição:*",
      "247,5 kcal | P 46,5 g | C 0 g | G 5,4 g",
    ]);
    expect(formatWhatsAppNutritionTotalsLine(totals)).toBe("247,5 kcal | P 46,5 g | C 0 g | G 5,4 g");
  });

  it("formata meta final e diferença como consumo menos meta", () => {
    expect(buildWhatsAppGoalProgressLines({
      consumedCalories: 1850,
      effectiveGoalCalories: 2000,
      exerciseCalories: 350,
    })).toEqual([
      "*Meta:* 2.000 kcal",
      "*Exercícios:* 350 kcal",
      "*Consumo:* 1.850 kcal (-150 kcal)",
    ]);
  });

  it("mostra sinal positivo quando o consumo excede a meta e zero quando são iguais", () => {
    expect(buildWhatsAppGoalProgressLines({
      consumedCalories: 2100,
      effectiveGoalCalories: 2000,
    })).toEqual([
      "*Meta:* 2.000 kcal",
      "*Consumo:* 2.100 kcal (+100 kcal)",
    ]);
    expect(buildWhatsAppGoalProgressLines({
      consumedCalories: 2000,
      effectiveGoalCalories: 2000,
    })).toEqual([
      "*Meta:* 2.000 kcal",
      "*Consumo:* 2.000 kcal (0 kcal)",
    ]);
  });

  it("inclui macronutrientes somente quando consumo e meta estão disponíveis", () => {
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
      "*Consumo:* 1.850 kcal (-150 kcal)",
      "",
      "*Macronutrientes*",
      "• P 110 g (-10 g)",
      "• C 130 g (-20 g)",
      "• G 55 g (+5 g)",
    ]);
  });
});
