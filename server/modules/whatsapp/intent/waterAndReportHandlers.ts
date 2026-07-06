import { getUserNutritionGoal } from "../../../db";
import { listMeals } from "../../meals/service";
import { createWaterLog } from "../../water/service";
import { countPeriodDays, formatReplyDateTime, isMealInsidePeriod, resolveRelativeOccurredAt } from "./dateTime";
import { sumMealItems, toMealItemInputs } from "./mealItemHelpers";
import { buildMealBreakdownLines, buildPeriodGoalSummaryLines } from "./report";
import { formatNumber } from "./textUtils";
import type { PeriodRange, WhatsappIntentResult } from "./types";

function buildSnackSuggestionReply() {
  return [
    "Sugestão para o lanche da tarde:",
    "",
    "• Iogurte natural com banana e aveia",
    "  Aproximadamente 280 kcal | boa proteína e energia para a tarde",
    "",
    "Outra opção:",
    "• Pão integral com queijo branco e tomate",
    "  Aproximadamente 300 kcal | simples, saciante e fácil de montar",
    "",
    "Se quiser, envie o que você tem em casa que eu sugiro uma opção mais certeira.",
  ].join("\n");
}

export async function handleSnackSuggestionIntent(): Promise<WhatsappIntentResult> {
  return {
    handled: true,
    action: "meal_suggestion",
    reply: buildSnackSuggestionReply(),
    eventType: "whatsapp.intent.meal_suggestion",
    detail: "Sugestão de lanche da tarde enviada pelo WhatsApp.",
  };
}

export async function handleWaterIntent(userId: number, text: string, receivedAt: Date, amountMl: number): Promise<WhatsappIntentResult> {
  const occurredAt = resolveRelativeOccurredAt(text, receivedAt);
  const created = await createWaterLog(userId, {
    amountMl,
    occurredAt: occurredAt.toISOString(),
  });

  return {
    handled: true,
    action: "water_logged",
    reply: `Registrei ${formatNumber(amountMl)} ml de água em ${formatReplyDateTime(occurredAt)}.`,
    eventType: "whatsapp.intent.water_logged",
    detail: `Consumo de ${amountMl} ml de água registrado após interpretação de data relativa pelo WhatsApp.`,
    data: {
      waterLogId: created.id,
      amountMl,
      occurredAt: occurredAt.toISOString(),
    },
  };
}

export async function handlePeriodReportIntent(userId: number, period: PeriodRange): Promise<WhatsappIntentResult> {
  const [meals, goal] = await Promise.all([
    listMeals(userId),
    getUserNutritionGoal(userId),
  ]);
  const mealsInPeriod = meals.filter(meal => isMealInsidePeriod(meal, period));
  const totals = mealsInPeriod.reduce(
    (acc, meal) => {
      const itemTotals = sumMealItems(toMealItemInputs(meal.items));
      acc.calories += itemTotals.calories;
      acc.protein += itemTotals.protein;
      acc.carbs += itemTotals.carbs;
      acc.fat += itemTotals.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  const periodDays = countPeriodDays(period);
  const goalCalories = Math.round((goal.today?.calories ?? 0) * periodDays);
  const diff = Math.round(totals.calories - goalCalories);
  const goalSummaryLines = buildPeriodGoalSummaryLines(goalCalories, diff);

  const reply = mealsInPeriod.length
    ? [
        `Resumo de ${period.label}:`,
        "",
        `Refeições registradas: ${mealsInPeriod.length}`,
        "",
        ...buildMealBreakdownLines(mealsInPeriod),
        ...(goalSummaryLines.length ? ["", ...goalSummaryLines] : []),
      ].join("\n")
    : [
        `Resumo de ${period.label}:`,
        "",
        "Não encontrei refeições registradas nesse período.",
      ].join("\n");

  return {
    handled: true,
    action: "period_report",
    reply,
    eventType: "whatsapp.intent.period_report",
    detail: `Relatório de ${period.label} enviado pelo WhatsApp com ${mealsInPeriod.length} refeição(ões).`,
    data: {
      periodLabel: period.label,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      mealCount: mealsInPeriod.length,
    },
  };
}
