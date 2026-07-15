import {
  getUserDayMealTotals,
  getUserNutritionGoal,
  listUserExercisesByDate,
  logInferenceEvent,
} from "../../db";
import { calculateAdjustedGoalCalories } from "../../../shared/reportsGoalAnalytics";
import { sumExercises } from "../exercises/store";
import { formatDateKeyInSaoPaulo } from "./webhookUtils";
import type { WhatsAppMealGoalProgress } from "./replyMessages";

type AppliedGoal = {
  calories: number;
  proteinGrams: number;
  carbsGrams: number;
  fatGrams: number;
  includeExerciseCalories: boolean;
};

async function resolveAppliedGoal(userId: number, dateKey: string): Promise<AppliedGoal> {
  const current = await getUserNutritionGoal(userId);
  if (!process.env.DATABASE_URL) return current.today;

  try {
    const { getNutritionGoalForDate } = await import("../goals/service");
    return (await getNutritionGoalForDate(userId, dateKey)).today;
  } catch (error) {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.goal_history_fallback",
      detail: error instanceof Error ? error.message : "Falha ao resolver versão histórica da meta.",
    });
    return current.today;
  }
}

async function resolveExerciseCalories(userId: number, dateKey: string) {
  if (!process.env.DATABASE_URL) return 0;
  const exercises = await listUserExercisesByDate(userId, dateKey);
  return Math.max(0, sumExercises(exercises));
}

/**
 * Resolve meta e exercícios pelo próprio usuário e pela data da refeição.
 * Não utiliza contexto de lote indexado apenas por data, evitando mistura entre
 * usuários processados no mesmo webhook.
 */
export async function getWhatsAppMealGoalProgress(
  userId: number,
  occurredAt: Date,
): Promise<WhatsAppMealGoalProgress | null> {
  try {
    const dateKey = formatDateKeyInSaoPaulo(occurredAt);
    const [appliedGoal, dayTotals, exerciseCalories] = await Promise.all([
      resolveAppliedGoal(userId, dateKey),
      getUserDayMealTotals(userId, dateKey),
      resolveExerciseCalories(userId, dateKey),
    ]);
    const effectiveGoalCalories = calculateAdjustedGoalCalories(
      appliedGoal.calories,
      exerciseCalories,
      appliedGoal.includeExerciseCalories,
    );

    return {
      consumedCalories: dayTotals.totals.calories,
      goalCalories: effectiveGoalCalories,
      exerciseCalories,
      includeExerciseCalories: appliedGoal.includeExerciseCalories,
      consumedProteinGrams: dayTotals.totals.protein,
      targetProteinGrams: appliedGoal.proteinGrams,
      consumedCarbsGrams: dayTotals.totals.carbs,
      targetCarbsGrams: appliedGoal.carbsGrams,
      consumedFatGrams: dayTotals.totals.fat,
      targetFatGrams: appliedGoal.fatGrams,
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
