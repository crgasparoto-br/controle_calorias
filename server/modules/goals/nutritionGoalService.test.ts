import { describe, expect, it } from "vitest";
import {
  IncompleteNutritionProfileError,
  NutritionGoalService,
} from "./nutritionGoalService";

describe("NutritionGoalService", () => {
  const service = new NutritionGoalService();
  const baseInput = {
    ageYears: 35,
    sex: "male" as const,
    weightKg: 80,
    heightCm: 180,
    activityLevel: "moderate" as const,
  };

  it("calcula BMR, TDEE e meta moderada para emagrecimento", () => {
    const result = service.calculate({ ...baseInput, objective: "emagrecimento" });

    expect(result.bmr).toBe(1755);
    expect(result.tdee).toBe(2720);
    expect(result.calculatedGoal.calories).toBe(2312);
    expect(result.calculatedGoal.proteinGrams).toBe(144);
    expect(result.calculatedGoal.fatGrams).toBe(64);
    expect(result.calculatedGoal.carbsGrams).toBe(290);
  });

  it("calcula meta de manutenção sem déficit ou superávit", () => {
    const result = service.calculate({ ...baseInput, objective: "manutencao" });

    expect(result.calculatedGoal.calories).toBe(result.tdee);
    expect(result.calculatedGoal.proteinGrams).toBe(128);
    expect(result.calculatedGoal.carbsGrams).toBeGreaterThan(0);
  });

  it("calcula meta com superávit moderado para ganho de massa", () => {
    const result = service.calculate({ ...baseInput, objective: "ganho_de_massa" });

    expect(result.calculatedGoal.calories).toBe(2992);
    expect(result.calculatedGoal.proteinGrams).toBe(160);
    expect(result.calculatedGoal.calories).toBeGreaterThan(result.tdee);
  });

  it("separa meta calculada de meta personalizada", () => {
    const customGoal = {
      calories: 2500,
      proteinGrams: 150,
      carbsGrams: 300,
      fatGrams: 70,
    };

    const result = service.calculate({ ...baseInput, objective: "melhora_de_habitos" }, customGoal);

    expect(result.calculatedGoal).not.toEqual(result.customGoal);
    expect(result.customGoal).toEqual(customGoal);
  });

  it("retorna erro claro quando dados do perfil estão incompletos", () => {
    expect(() => service.calculate({
      objective: "manutencao",
      weightKg: 80,
    })).toThrow(IncompleteNutritionProfileError);
    expect(() => service.calculate({
      objective: "manutencao",
      weightKg: 80,
    })).toThrow("ageYears, heightCm, activityLevel");
  });
});
