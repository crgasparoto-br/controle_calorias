import { describe, expect, it } from "vitest";
import { onboardingSchema } from "./schemas";
import {
  calculateOnboardingNutritionGoal,
  resolveNutritionCalculationSex,
  shouldRecalculateOnboardingGoals,
} from "./service";

const baseInput = {
  name: "Pessoa Teste",
  birthDate: "1990-01-01",
  heightCm: 170,
  currentWeightKg: 70,
  objective: "manter_peso" as const,
  activityLevel: "moderate" as const,
  trackingExperience: "beginner" as const,
  dietaryPreferences: [],
  dietaryRestrictions: [],
  eatingRoutine: "misto" as const,
  mainDifficulty: "falta_de_planejamento" as const,
  timezone: "America/Sao_Paulo" as const,
};

describe("onboarding settings goal recalculation", () => {
  it("recalcula metas no cadastro inicial mesmo sem flag explícita", () => {
    expect(shouldRecalculateOnboardingGoals(false, undefined)).toBe(true);
  });

  it("preserva metas em edição posterior quando recálculo não foi confirmado", () => {
    expect(shouldRecalculateOnboardingGoals(true, undefined)).toBe(false);
    expect(shouldRecalculateOnboardingGoals(true, false)).toBe(false);
  });

  it("recalcula metas em edição posterior apenas com confirmação explícita", () => {
    expect(shouldRecalculateOnboardingGoals(true, true)).toBe(true);
  });

  it("usa sexo informado quando a fórmula nutricional suporta o valor", () => {
    expect(resolveNutritionCalculationSex("female")).toBe("female");
    expect(resolveNutritionCalculationSex("male")).toBe("male");
    expect(resolveNutritionCalculationSex("non_binary")).toBe("not_informed");
    expect(resolveNutritionCalculationSex("prefer_not_to_say")).toBe("not_informed");
  });

  it("gera metas iniciais diferentes para sexo feminino e masculino quando informado", () => {
    const femaleInput = onboardingSchema.parse({ ...baseInput, sex: "female" });
    const maleInput = onboardingSchema.parse({ ...baseInput, sex: "male" });

    const femaleGoal = calculateOnboardingNutritionGoal(femaleInput);
    const maleGoal = calculateOnboardingNutritionGoal(maleInput);

    expect(maleGoal.bmr).toBeGreaterThan(femaleGoal.bmr);
    expect(maleGoal.calculatedGoal.calories).toBeGreaterThan(femaleGoal.calculatedGoal.calories);
  });
});
