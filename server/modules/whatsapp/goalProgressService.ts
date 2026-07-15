import { getUserDayMealTotals, listUserExercisesByDate, logInferenceEvent } from "../../db";
import { calculateAdjustedGoalCalories } from "../../../shared/reportsGoalAnalytics";
import { sumExercises } from "../exercises/store";
import { getNutritionGoalForDate } from "../goals/service";
import { formatDateKeyInSaoPaulo } from "./webhookUtils";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

export type WhatsAppEffectiveGoalForDate = {
  dateKey: string;
  effectiveGoalCalories: number;
  exerciseCalories: number;
  targetProteinGrams: number;
  targetCarbsGrams: number;
  targetFatGrams: number;
};

/**
 * Resolve a meta aplicável por usuário e data usando o mesmo histórico de metas
 * consumido por Hoje/Relatórios. Exercícios são consultados para o próprio
 * usuário; nenhum estado de lote ou chave apenas por data participa do cálculo.
 */
export async function getWhatsAppEffectiveGoalForDate(
  userId: number,
  dateKey: string,
): Promise<WhatsAppEffectiveGoalForDate> {
  const [goalSummary, exercises] = await Promise.all([
    getNutritionGoalForDate(userId, dateKey),
    listUserExercisesByDate(userId, dateKey),
  ]);
  const appliedGoal = goalSummary.today;
  const exerciseCalories = Math.max(0, sumExercises(exercises));
  const effectiveGoalCalories = calculateAdjustedGoalCalories(
    appliedGoal.calories,
    exerciseCalories,
    appliedGoal.includeExerciseCalories,
  );

  return {
    dateKey,
    effectiveGoalCalories,
    exerciseCalories,
    targetProteinGrams: appliedGoal.proteinGrams,
    targetCarbsGrams: appliedGoal.carbsGrams,
    targetFatGrams: appliedGoal.fatGrams,
  };
}

export async function getWhatsAppMealGoalProgress(
  userId: number,
  occurredAt: Date,
): Promise<WhatsAppMealGoalProgress | null> {
  try {
    const dateKey = formatDateKeyInSaoPaulo(occurredAt);
    const [goal, dayTotals] = await Promise.all([
      getWhatsAppEffectiveGoalForDate(userId, dateKey),
      getUserDayMealTotals(userId, dateKey),
    ]);

    return {
      consumedCalories: dayTotals.totals.calories,
      effectiveGoalCalories: goal.effectiveGoalCalories,
      exerciseCalories: goal.exerciseCalories,
      consumedProteinGrams: dayTotals.totals.protein,
      targetProteinGrams: goal.targetProteinGrams,
      consumedCarbsGrams: dayTotals.totals.carbs,
      targetCarbsGrams: goal.targetCarbsGrams,
      consumedFatGrams: dayTotals.totals.fat,
      targetFatGrams: goal.targetFatGrams,
    };
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.goal_progress_warning",
      detail: error instanceof Error ? error.message : "Falha desconhecida ao resolver progresso de meta para resposta do WhatsApp.",
    });
    return null;
  }
}
