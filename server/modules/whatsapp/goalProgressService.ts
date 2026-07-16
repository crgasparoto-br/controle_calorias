import { getUserDayMealTotals, logInferenceEvent } from "../../db";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { getWhatsAppOperationTimeZone } from "./timeZoneContext";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

function safeLogGoalWarning(input: Parameters<typeof logInferenceEvent>[0]) {
  try {
    logInferenceEvent(input);
  } catch {
    // Mocks parciais de db não podem transformar um fallback opcional em rejeição não tratada.
  }
}

async function resolveEffectiveGoal(userId: number, dateKey: string, timeZone: string) {
  try {
    const { getEffectiveNutritionGoalForDate } = await import("../goals/service");
    return await getEffectiveNutritionGoalForDate(userId, dateKey, timeZone);
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
  explicitTimeZone?: string,
): Promise<WhatsAppMealGoalProgress | null> {
  try {
    const timeZone = explicitTimeZone ?? await getWhatsAppOperationTimeZone(userId);
    const dateKey = getDateKeyInTimeZone(occurredAt, timeZone);
    const [goal, dayTotals] = await Promise.all([
      resolveEffectiveGoal(userId, dateKey, timeZone),
      getUserDayMealTotals(userId, dateKey, timeZone),
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
