import { describe, expect, it } from "vitest";
import { assessNutritionGoalInput, assessNutritionGoalTargets } from "@shared/nutritionSafety";

describe("nutrition safety", () => {
  it("bloqueia metas nutricionais extremas com mensagens neutras", () => {
    const assessment = assessNutritionGoalTargets([
      {
        label: "Meta geral",
        calories: 900,
        proteinGrams: 20,
        carbsGrams: 120,
        fatGrams: 10,
      },
    ]);

    expect(assessment.blockers.map(issue => issue.code)).toEqual([
      "calories_too_low",
      "protein_too_low",
      "fat_too_low",
    ]);
    expect(assessment.blockers[0]?.message).toContain("não podem ser salvas aqui");
    expect(assessment.blockers[0]?.message).not.toMatch(/culpa|falha|errado|proibido/i);
  });

  it("permite salvar metas de atenção como alerta sem bloquear", () => {
    const assessment = assessNutritionGoalInput({
      defaultGoal: {
        calories: 1450,
        proteinGrams: 130,
        carbsGrams: 120,
        fatGrams: 45,
      },
      exceptions: [],
    });

    expect(assessment.blockers).toHaveLength(0);
    expect(assessment.warnings.map(issue => issue.code)).toContain("calories_low");
  });
});
