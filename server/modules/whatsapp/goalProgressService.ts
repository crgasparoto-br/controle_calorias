import { getDashboardTodayOverview } from "../insights/service";
import { logInferenceEvent } from "../../db";
import { formatDateKeyInSaoPaulo } from "./webhookUtils";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

/**
 * Usa o mesmo contrato canônico de Hoje/Relatórios para evitar uma segunda
 * implementação da regra da #756 dentro do WhatsApp.
 */
export async function getWhatsAppMealGoalProgress(
  userId: number,
  occurredAt: Date,
): Promise<WhatsAppMealGoalProgress | null> {
  try {
    const dateKey = formatDateKeyInSaoPaulo(occurredAt);
    const overview = await getDashboardTodayOverview(userId, { date: dateKey });

    return {
      consumedCalories: overview.today.consumed.calories,
      effectiveGoalCalories: overview.today.goal.adjustedCalories,
      exerciseCalories: overview.today.burned.calories,
      consumedProteinGrams: overview.today.consumed.protein,
      targetProteinGrams: overview.today.goal.protein,
      consumedCarbsGrams: overview.today.consumed.carbs,
      targetCarbsGrams: overview.today.goal.carbs,
      consumedFatGrams: overview.today.consumed.fat,
      targetFatGrams: overview.today.goal.fat,
    };
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.goal_progress_warning",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao carregar progresso canônico para resposta do WhatsApp.",
    });
    return null;
  }
}
