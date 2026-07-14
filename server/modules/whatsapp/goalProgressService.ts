import { calculateAdjustedGoalCalories } from "../../../shared/reportsGoalAnalytics";
import { getUserDayMealTotals, getUserNutritionGoal, logInferenceEvent } from "../../db";
import { getWhatsAppExerciseCaloriesForDateKey } from "./goalProgressContext";
import { formatDateKeyInSaoPaulo } from "./webhookUtils";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

export async function getWhatsAppMealGoalProgress(userId: number, occurredAt: Date): Promise<WhatsAppMealGoalProgress | null> {
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

    return {
      consumedCalories: dayTotals.totals.calories,
      // Compatibilidade temporária com o contrato atual de `replyMessages`.
      // Este valor já é a meta final; formatters não recalculam a regra da #756.
      goalCalories: effectiveGoalCalories,
      exerciseCalories,
      includeExerciseCalories: false,
    };
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
