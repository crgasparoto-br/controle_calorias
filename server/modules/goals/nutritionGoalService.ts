import { assessNutritionGoalTargets } from "@shared/nutritionSafety";

export type NutritionObjective = "emagrecimento" | "manutencao" | "ganho_de_massa" | "melhora_de_habitos";
export type BiologicalSex = "female" | "male" | "not_informed";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "very_active";

export type CalculatedNutritionGoalInput = {
  ageYears?: number;
  sex?: BiologicalSex;
  weightKg?: number;
  heightCm?: number;
  activityLevel?: ActivityLevel;
  objective: NutritionObjective;
};

export type NutritionGoalTarget = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
};

export type NutritionGoalCalculation = {
  bmr: number;
  tdee: number;
  objective: NutritionObjective;
  calculatedGoal: NutritionGoalTarget;
  customGoal?: NutritionGoalTarget;
  safetyWarnings: ReturnType<typeof assessNutritionGoalTargets>["warnings"];
};

export class IncompleteNutritionProfileError extends Error {
  constructor(missingFields: string[]) {
    super(`Dados insuficientes para calcular a meta nutricional: ${missingFields.join(", ")}.`);
    this.name = "IncompleteNutritionProfileError";
  }
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

const OBJECTIVE_CALORIE_FACTORS: Record<NutritionObjective, number> = {
  emagrecimento: 0.85,
  manutencao: 1,
  ganho_de_massa: 1.1,
  melhora_de_habitos: 1,
};

const PROTEIN_GRAMS_PER_KG: Record<NutritionObjective, number> = {
  emagrecimento: 1.8,
  manutencao: 1.6,
  ganho_de_massa: 2,
  melhora_de_habitos: 1.4,
};

const MIN_SAFE_CALORIES = 1200;
const FAT_CALORIE_RATIO = 0.25;

function round(value: number) {
  return Math.round(value);
}

function missingRequiredFields(input: CalculatedNutritionGoalInput) {
  const missing: string[] = [];
  if (!input.ageYears) missing.push("ageYears");
  if (!input.weightKg) missing.push("weightKg");
  if (!input.heightCm) missing.push("heightCm");
  if (!input.activityLevel) missing.push("activityLevel");
  return missing;
}

export class NutritionGoalService {
  calculate(input: CalculatedNutritionGoalInput, customGoal?: NutritionGoalTarget): NutritionGoalCalculation {
    const missing = missingRequiredFields(input);
    if (missing.length) {
      throw new IncompleteNutritionProfileError(missing);
    }

    const ageYears = input.ageYears!;
    const sex = input.sex!;
    const weightKg = input.weightKg!;
    const heightCm = input.heightCm!;
    const activityLevel = input.activityLevel!;

    const bmr = this.calculateBmr({ ageYears, sex, weightKg, heightCm });
    const tdee = this.calculateTdee(bmr, activityLevel);
    const calculatedGoal = this.calculateGoalTarget({
      objective: input.objective,
      tdee,
      weightKg,
    });
    const safetyAssessment = assessNutritionGoalTargets([
      { label: "Meta calculada", ...calculatedGoal },
      ...(customGoal ? [{ label: "Meta personalizada", ...customGoal }] : []),
    ]);

    if (safetyAssessment.blockers.length) {
      throw new Error(safetyAssessment.blockers.map(issue => issue.message).join(" "));
    }

    return {
      bmr,
      tdee,
      objective: input.objective,
      calculatedGoal,
      customGoal,
      safetyWarnings: safetyAssessment.warnings,
    };
  }

  calculateBmr(input: Required<Pick<CalculatedNutritionGoalInput, "ageYears" | "sex" | "weightKg" | "heightCm">>) {
    // Mifflin-St Jeor: estimativa basal baseada em peso, altura, idade e sexo biológico.
    const sexOffset = input.sex === "male" ? 5 : input.sex === "female" ? -161 : -78;
    return round((10 * input.weightKg) + (6.25 * input.heightCm) - (5 * input.ageYears) + sexOffset);
  }

  calculateTdee(bmr: number, activityLevel: ActivityLevel) {
    // TDEE: BMR multiplicado por fator de atividade diário.
    return round(bmr * ACTIVITY_MULTIPLIERS[activityLevel]);
  }

  calculateGoalTarget(input: { objective: NutritionObjective; tdee: number; weightKg: number }): NutritionGoalTarget {
    // Objetivos usam déficit/superávit moderado; melhora de hábitos começa em manutenção.
    const calories = Math.max(MIN_SAFE_CALORIES, round(input.tdee * OBJECTIVE_CALORIE_FACTORS[input.objective]));
    const proteinGrams = round(input.weightKg * PROTEIN_GRAMS_PER_KG[input.objective]);
    const fatGrams = round((calories * FAT_CALORIE_RATIO) / 9);
    const proteinCalories = proteinGrams * 4;
    const fatCalories = fatGrams * 9;
    const carbsGrams = Math.max(0, round((calories - proteinCalories - fatCalories) / 4));

    return {
      calories,
      proteinGrams,
      carbsGrams,
      fatGrams,
    };
  }
}

export const nutritionGoalService = new NutritionGoalService();
