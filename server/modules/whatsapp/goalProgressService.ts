import { getUserDayMealTotals, getUserNutritionGoal, logInferenceEvent } from "../../db";
import { formatDateKeyInSaoPaulo } from "./webhookUtils";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

function safeLogGoalWarning(input: Parameters<typeof logInferenceEvent>[0]) {
  try {
    logInferenceEvent(input);
  } catch {
    // Mocks parciais de db não podem transformar um fallback opcional em rejeição não tratada.
  }
}

async function resolveEffectiveGoal(userId: number, dateKey: string) {
  if (!process.env.DATABASE_URL) {
    const current = await getUserNutritionGoal(userId);
    return {
      effectiveGoalCalories: current.today.calories,
      exerciseCalories: 0,
      includeExerciseCalories: current.today.includeExerciseCalories,
    };
  }

  try {
    const { getEffectiveNutritionGoalForDate } = await import("../goals/service");
    return getEffectiveNutritionGoalForDate(userId, dateKey);
  } catch (error) {
    const current = await getUserNutritionGoal(userId);
    safeLogGoalWarning({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.goal_history_fallback",
      detail: error instanceof Error ? error.message : "Falha ao resolver meta efetiva histórica.",
    });
    return {
      effectiveGoalCalories: current.today.calories,
      exerciseCalories: 0,
      includeExerciseCalories: current.today.includeExerciseCalories,
    };
  }
}

export async function getWhatsAppMealGoalProgress(
  userId: number,
  occurredAt: Date,
): Promise<WhatsAppMealGoalProgress | null> {
  try {
    const dateKey = formatDateKeyInSaoPaulo(occurredAt);
    const [goal, dayTotals] = await Promise.all([
      resolveEffectiveGoal(userId, dateKey),
      getUserDayMealTotals(userId, dateKey),
    ]);

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
