import { describe, expect, it } from "vitest";
import {
  buildWhatsAppCanonicalPeriodProgressLines,
  buildWhatsAppCanonicalWaterReply,
  buildWhatsAppCanonicalWeightReply,
} from "./domainReplyFormatters";

describe("domainReplyFormatters", () => {
  it("formata período com meta efetiva, consumo-meta e P/C/G", () => {
    expect(buildWhatsAppCanonicalPeriodProgressLines({
      effectiveGoalCalories: 4000,
      consumedCalories: 3700,
      exerciseCalories: 500,
      consumedProteinGrams: 210,
      targetProteinGrams: 240,
      consumedCarbsGrams: 300,
      targetCarbsGrams: 320,
      consumedFatGrams: 110,
      targetFatGrams: 100,
    })).toEqual([
      "*Meta:* 4.000 kcal",
      "*Exercícios:* 500 kcal",
      "*Consumo:* 3.700 kcal (-300 kcal)",
      "",
      "*Macronutrientes*",
      "• P 210 g (-30 g)",
      "• C 300 g (-20 g)",
      "• G 110 g (+10 g)",
    ]);
  });

  it("formata água usando consumo menos meta", () => {
    expect(buildWhatsAppCanonicalWaterReply({
      amountMl: 500,
      totalMl: 1800,
      goalMl: 2500,
      occurredAtLabel: "hoje, 14:30",
      totalLabel: "Total de hoje",
    })).toContain("*Meta:* 2.500 ml (-700 ml)");
  });

  it("mostra variação de peso sem julgamento", () => {
    expect(buildWhatsAppCanonicalWeightReply({
      weightKg: 66.3,
      variationKg: -0.4,
      occurredAtLabel: "hoje, 08:00",
    })).toContain("*Variação:* -0,4 kg");
  });
});
