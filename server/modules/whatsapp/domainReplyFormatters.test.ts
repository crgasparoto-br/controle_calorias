import { describe, expect, it } from "vitest";
import {
  buildWhatsAppCanonicalExerciseReply,
  buildWhatsAppCanonicalPeriodProgressLines,
  buildWhatsAppCanonicalWaterReply,
  buildWhatsAppCanonicalWeightReply,
} from "./domainReplyFormatters";

describe("domainReplyFormatters", () => {
  it("formata período com déficit e percentuais de P/C/G", () => {
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
      "*Consumo:* 3.700 kcal",
      "*Déficit:* 300 kcal (-7%)",
      "",
      "*Macronutrientes*",
      "• P 210 g (-30 g/-12%)",
      "• C 300 g (-20 g/-6%)",
      "• G 110 g (+10 g/+10%)",
    ]);
  });

  it("preserva uma casa decimal no superávit do resumo", () => {
    expect(buildWhatsAppCanonicalPeriodProgressLines({
      effectiveGoalCalories: 1553,
      consumedCalories: 1587.8,
      exerciseCalories: 0,
    })).toEqual([
      "*Meta:* 1.553 kcal",
      "*Exercícios:* 0 kcal",
      "*Consumo:* 1.587,8 kcal",
      "*Superávit:* 34,8 kcal (+2%)",
    ]);
  });

  it("classifica como equilíbrio quando a diferença desaparece na precisão exibida", () => {
    expect(buildWhatsAppCanonicalPeriodProgressLines({
      effectiveGoalCalories: 2000.04,
      consumedCalories: 2000.03,
    })).toEqual([
      "*Meta:* 2.000 kcal",
      "*Consumo:* 2.000 kcal",
      "*Equilíbrio:* 0 kcal (0%)",
    ]);
  });

  it("não inventa meta, saldo ou macro quando o domínio não fornece valores válidos", () => {
    expect(buildWhatsAppCanonicalPeriodProgressLines({
      effectiveGoalCalories: null,
      consumedCalories: 3700,
      consumedProteinGrams: 210,
      targetProteinGrams: null,
    })).toEqual([
      "*Meta:* não disponível para este período",
      "*Consumo:* 3.700 kcal",
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

  it("explicita meta de água indisponível sem assumir zero", () => {
    expect(buildWhatsAppCanonicalWaterReply({
      amountMl: 500,
      totalMl: 1800,
      goalMl: null,
      occurredAtLabel: "hoje, 14:30",
      totalLabel: "Total de hoje",
    })).toContain("*Meta:* não disponível");
  });

  it("mostra variação de peso sem julgamento", () => {
    expect(buildWhatsAppCanonicalWeightReply({
      weightKg: 66.3,
      variationKg: -0.4,
      occurredAtLabel: "hoje, 08:00",
    })).toContain("*Variação:* -0,4 kg");
  });

  it("preserva o contrato do formatter de exercícios", () => {
    const reply = buildWhatsAppCanonicalExerciseReply({
      activity: "Corrida",
      durationMinutes: 45,
      distanceKm: 8.2,
      calories: 520,
      occurredAtLabel: "hoje, 07:00",
      caloriesEstimated: true,
    });

    expect(reply).toContain("🏃 *Exercício registrado*");
    expect(reply).toContain("*Atividade:* Corrida");
    expect(reply).toContain("*Duração:* 45 min");
    expect(reply).toContain("*Distância:* 8,2 km");
    expect(reply).toContain("*Calorias:* 520 kcal");
    expect(reply).toContain("⚠️ Calorias estimadas pelo sistema.");
  });
});
