import { getUserDayMealTotals, getUserNutritionGoal, logInferenceEvent } from "../../db";
import { calculateAdjustedGoalCalories } from "../../../shared/reportsGoalAnalytics";
import { getWhatsAppExerciseCaloriesForDateKey } from "./goalProgressContext";
import { formatDateKeyInSaoPaulo } from "./webhookUtils";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

/**
 * Resolve a meta efetiva antes da apresentação. O formatter não conhece nem
 * recalcula a regra da #756; ele recebe somente o valor final aplicável.
 */
export async function getWhatsAppMealGoalProgress(
  userId: number,
  occurredAt: Date,
): Promise<WhatsAppMealGoalProgress | null> {
  try {
    const dateKey = formatDateKeyInSaoPaulo(occurredAt);
    const [goalSummary, dayTotals] = await Promise.all([
      getUserNutritionGoal(userId),
      getUserDayMealTotals(userId, dateKey),
    ]);
    const exerciseCalories = Math.max(0, getWhatsAppExerciseCaloriesForDateKey(dateKey) ?? 0);
    const effectiveGoalCalories = calculateAdjustedGoalCalories(
      goalSummary.today.calories,
      exerciseCalories,
      goalSummary.today.includeExerciseCalories,
    );

    const progress = {
      consumedCalories: dayTotals.totals.calories,
      goalCalories: effectiveGoalCalories,
      effectiveGoalCalories,
      exerciseCalories,
      includeExerciseCalories: goalSummary.today.includeExerciseCalories,
    };
    return progress;
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.goal_progress_warning",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao calcular progresso da meta para resposta do WhatsApp.",
    });
    return null;
  }
}
