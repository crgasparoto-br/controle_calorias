import { getUserDayMealTotals, logInferenceEvent } from "../../db";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { getUserOnboardingProfile } from "../onboarding/profileRead";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

function safeLogGoalWarning(input: Parameters<typeof logInferenceEvent>[0]) {
  try {
    logInferenceEvent(input);
  } catch {
    // Mocks parciais de db não podem transformar um fallback opcional em rejeição não tratada.
  }
}

async function resolveUserTimeZone(userId: number) {
  try {
    return (await getUserOnboardingProfile(userId))?.timezone ?? DEFAULT_APP_TIME_ZONE;
  } catch {
    return DEFAULT_APP_TIME_ZONE;
  }
}

async function resolveEffectiveGoal(userId: number, dateKey: string) {
  try {
    const { getEffectiveNutritionGoalForDate } = await import("../goals/service");
    return await getEffectiveNutritionGoalForDate(userId, dateKey);
  } catch (error) {
    safeLogGoalWarning({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.goal_history_unavailable",
      detail: error instanceof Error ? error.message : "Falha ao resolver meta efetiva histórica.",
    });
    return null;
  }
}

export async function getWhatsAppMealGoalProgress(
  userId: number,
  occurredAt: Date,
): Promise<WhatsAppMealGoalProgress | null> {
  try {
    const timeZone = await resolveUserTimeZone(userId);
    const dateKey = getDateKeyInTimeZone(occurredAt, timeZone);
    const [goal, dayTotals] = await Promise.all([
      resolveEffectiveGoal(userId, dateKey),
      getUserDayMealTotals(userId, dateKey),
    ]);
    if (!goal) return null;

    return {
      consumedCalories: dayTotals.totals.calories,
      goalCalories: goal.effectiveGoalCalories,
      exerciseCalories: goal.exerciseCalories,
      includeExerciseCalories: goal.includeExerciseCalories,
    };
  } catch (error) {
    safeLogGoalWarning({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.goal_progress_warning",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao resolver progresso de meta para resposta do WhatsApp.",
    });
    return null;
  }
}
