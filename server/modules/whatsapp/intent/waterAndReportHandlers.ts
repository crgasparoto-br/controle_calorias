import { getPeriodReportBundle } from "../../insights/service";
import { listMeals } from "../../meals/service";
import { createWaterLog } from "../../water/service";
import {
  buildWhatsAppPeriodReportReplyMessage,
  buildWhatsAppSnackSuggestionReplyMessage,
  buildWhatsAppWaterLoggedReplyMessage,
} from "../replyMessages";
import { buildWhatsAppGoalProgressLines } from "../replyTemplates";
import { getWhatsAppWaterProgress } from "../userMeasurementReplyContext";
import {
  formatReplyDateTime,
  getZonedParts,
  isMealInsidePeriod,
  resolveRelativeOccurredAt,
} from "./dateTime";
import { buildMealBreakdownLines } from "./report";
import { formatNumber } from "./textUtils";
import type { PeriodRange, WhatsappIntentResult } from "./types";

function dateKey(date: Date) {
  const parts = getZonedParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export async function handleSnackSuggestionIntent(): Promise<WhatsappIntentResult> {
  return {
    handled: true,
    action: "meal_suggestion",
    reply: buildWhatsAppSnackSuggestionReplyMessage(),
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
  const waterProgress = await getWhatsAppWaterProgress(userId, occurredAt);

  return {
    handled: true,
    action: "water_logged",
    reply: buildWhatsAppWaterLoggedReplyMessage({
      amountLabel: formatNumber(amountMl),
      occurredAtLabel: formatReplyDateTime(occurredAt),
      totalMl: waterProgress.totalMl,
      goalMl: waterProgress.goalMl,
    }),
    eventType: "whatsapp.intent.water_logged",
    detail: `Consumo de ${amountMl} ml de água registrado após interpretação de data relativa pelo WhatsApp.`,
    data: {
      waterLogId: created.id,
      amountMl,
      totalMl: waterProgress.totalMl,
      goalMl: waterProgress.goalMl,
      occurredAt: occurredAt.toISOString(),
    },
  };
}

export async function handlePeriodReportIntent(userId: number, period: PeriodRange): Promise<WhatsappIntentResult> {
  const range = {
    startDate: dateKey(period.start),
    endDate: dateKey(period.end),
  };
  const [bundle, meals] = await Promise.all([
    getPeriodReportBundle(userId, range),
    listMeals(userId),
  ]);
  const mealsInPeriod = meals.filter(meal => isMealInsidePeriod(meal, period));
  const effectiveGoalCalories = bundle.daily.reduce((total, day) => total + Number(day.adjustedGoalCalories ?? 0), 0);
  const exerciseCalories = bundle.daily.reduce((total, day) => total + Number(day.exerciseCalories ?? 0), 0);
  const targetProteinGrams = bundle.daily.reduce((total, day) => total + Number(day.goalProtein ?? 0), 0);
  const targetCarbsGrams = bundle.daily.reduce((total, day) => total + Number(day.goalCarbs ?? 0), 0);
  const targetFatGrams = bundle.daily.reduce((total, day) => total + Number(day.goalFat ?? 0), 0);
  const goalSummaryLines = buildWhatsAppGoalProgressLines({
    effectiveGoalCalories,
    consumedCalories: bundle.totals.calories,
    exerciseCalories,
    consumedProteinGrams: bundle.totals.protein,
    targetProteinGrams,
    consumedCarbsGrams: bundle.totals.carbs,
    targetCarbsGrams,
    consumedFatGrams: bundle.totals.fat,
    targetFatGrams,
  });

  const reply = buildWhatsAppPeriodReportReplyMessage({
    periodLabel: period.label,
    mealCount: mealsInPeriod.length,
    mealBreakdownLines: buildMealBreakdownLines(mealsInPeriod),
    goalSummaryLines,
  });

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
      reportContract: "domain-period-bundle-v1",
    },
  };
}
