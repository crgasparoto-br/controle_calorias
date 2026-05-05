import { saveUserOnboardingProfile } from "../../db";
import { updateNutritionGoal } from "../goals/service";
import { nutritionGoalService, type ActivityLevel, type NutritionObjective } from "../goals/nutritionGoalService";
import type { OnboardingInput } from "./schemas";

const OBJECTIVE_MAP: Record<OnboardingInput["objective"], NutritionObjective> = {
  emagrecer: "emagrecimento",
  manter_peso: "manutencao",
  ganhar_massa: "ganho_de_massa",
  melhorar_habitos: "melhora_de_habitos",
};

export async function completeOnboarding(userId: number, input: OnboardingInput) {
  const calculation = nutritionGoalService.calculate({
    ageYears: input.ageYears,
    sex: "not_informed",
    weightKg: input.currentWeightKg,
    heightCm: input.heightCm,
    activityLevel: input.activityLevel as ActivityLevel,
    objective: OBJECTIVE_MAP[input.objective],
  });

  const savedProfile = await saveUserOnboardingProfile(userId, input);
  const goal = await updateNutritionGoal(userId, {
    defaultGoal: calculation.calculatedGoal,
    exceptions: [],
  });

  return {
    profile: savedProfile,
    calculation,
    goal,
  };
}
