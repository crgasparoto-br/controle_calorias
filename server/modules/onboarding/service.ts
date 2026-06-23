import { eq } from "drizzle-orm";
import { userProfiles } from "../../../drizzle/schema";
import { getDb, saveUserOnboardingProfile } from "../../db";
import { updateNutritionGoal } from "../goals/service";
import { nutritionGoalService, type ActivityLevel, type BiologicalSex, type NutritionObjective } from "../goals/nutritionGoalService";
import { persistOnboardingBirthDate } from "./profilePersistence";
import type { OnboardingInput } from "./schemas";

const OBJECTIVE_MAP: Record<OnboardingInput["objective"], NutritionObjective> = {
  emagrecer: "emagrecimento",
  manter_peso: "manutencao",
  ganhar_massa: "ganho_de_massa",
  melhorar_habitos: "melhora_de_habitos",
};

async function getOnboardingCompletedAt(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select({ onboardingCompletedAt: userProfiles.onboardingCompletedAt })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  return rows[0]?.onboardingCompletedAt ?? null;
}

async function persistProfileTimeZone(userId: number, timezone: string) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(userProfiles)
    .set({ timezone, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId));
}

async function persistProfileSex(userId: number, sex: OnboardingInput["sex"]) {
  const db = await getDb();
  if (!db) return;

  await db
    .update(userProfiles)
    .set({ sex, updatedAt: new Date() })
    .where(eq(userProfiles.userId, userId));
}

export function resolveNutritionCalculationSex(sex: OnboardingInput["sex"]): BiologicalSex {
  return sex === "female" || sex === "male" ? sex : "not_informed";
}

export function shouldRecalculateOnboardingGoals(hasCompletedOnboarding: boolean, recalculateGoals: boolean | undefined) {
  return !hasCompletedOnboarding || recalculateGoals === true;
}

export function calculateOnboardingNutritionGoal(input: OnboardingInput) {
  return nutritionGoalService.calculate({
    ageYears: input.ageYears,
    sex: resolveNutritionCalculationSex(input.sex),
    weightKg: input.currentWeightKg,
    heightCm: input.heightCm,
    activityLevel: input.activityLevel as ActivityLevel,
    objective: OBJECTIVE_MAP[input.objective],
  });
}

export async function completeOnboarding(userId: number, input: OnboardingInput) {
  const existingCompletedAt = await getOnboardingCompletedAt(userId);
  const completedInitialOnboarding = !existingCompletedAt;
  const shouldRecalculateGoals = shouldRecalculateOnboardingGoals(Boolean(existingCompletedAt), input.recalculateGoals);

  const savedProfile = await saveUserOnboardingProfile(userId, input);
  await persistProfileTimeZone(userId, input.timezone);
  await persistProfileSex(userId, input.sex);
  await persistOnboardingBirthDate(userId, input);

  const calculation = shouldRecalculateGoals ? calculateOnboardingNutritionGoal(input) : null;
  const goal = calculation
    ? await updateNutritionGoal(userId, {
        defaultGoal: calculation.calculatedGoal,
        exceptions: [],
      })
    : null;

  return {
    profile: { ...savedProfile, birthDate: input.birthDate, ageYears: input.ageYears, sex: input.sex, timezone: input.timezone },
    calculation,
    goal,
    recalculatedGoals: Boolean(calculation),
    completedInitialOnboarding,
  };
}
