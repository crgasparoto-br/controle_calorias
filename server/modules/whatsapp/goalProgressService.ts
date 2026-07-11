import { getUserDayMealTotals, getUserNutritionGoal, logInferenceEvent } from "../../db";
import { formatDateKeyInSaoPaulo } from "./webhookUtils";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

export async function getWhatsAppMealGoalProgress(userId: number, occurredAt: Date): Promise<WhatsAppMealGoalProgress | null> {
  try {
    const [goalSummary, dayTotals] = await Promise.all([
      getUserNutritionGoal(userId),
      getUserDayMealTotals(userId, formatDateKeyInSaoPaulo(occurredAt)),
    ]);

    return {
      consumedCalories: dayTotals.totals.calories,
      goalCalories: goalSummary.today.calories,
      includeExerciseCalories: goalSummary.today.includeExerciseCalories,
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
