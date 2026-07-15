import { listMeals } from "../../meals/service";
import { createWaterLog } from "../../water/service";
import {
  buildWhatsAppPeriodReportReplyMessage,
  buildWhatsAppSnackSuggestionReplyMessage,
  buildWhatsAppWaterLoggedReplyMessage,
} from "../replyMessages";
import {
  buildWhatsAppCanonicalPeriodProgressLines,
  buildWhatsAppCanonicalWaterReply,
} from "../domainReplyFormatters";
import { getDateKeyInTimeZone } from "../../../../shared/timeZone";
import { formatReplyDateTime, isMealInsidePeriod, resolveRelativeOccurredAt } from "./dateTime";
import { sumMealItems, toMealItemInputs } from "./mealItemHelpers";
import { buildMealBreakdownLines } from "./report";
import { formatNumber } from "./textUtils";
import type { PeriodRange, WhatsappIntentResult } from "./types";

function sameDay(first: Date, second: Date, timeZone: string) {
  return getDateKeyInTimeZone(first, timeZone) === getDateKeyInTimeZone(second, timeZone);
}

async function buildWaterReply(userId: number, amountMl: number, occurredAt: Date, timeZone: string) {
  if (!process.env.DATABASE_URL) {
    return buildWhatsAppWaterLoggedReplyMessage({
      amountLabel: formatNumber(amountMl),
      occurredAtLabel: formatReplyDateTime(occurredAt, timeZone),
    });
  }

  try {
    const db = await import("../../../db");
    const [goal, logs] = await Promise.all([
      db.getUserWaterGoal(userId),
      db.listUserWaterLogs(userId),
    ]);
    const dateKey = getDateKeyInTimeZone(occurredAt, timeZone);
    const totalMl = logs
      .filter(log => getDateKeyInTimeZone(new Date(log.occurredAt), timeZone) === dateKey)
      .reduce((total, log) => total + Number(log.amountMl ?? 0), 0);
    const today = new Date();
    const rawGoal = Number(goal.dailyTargetMl);

    return buildWhatsAppCanonicalWaterReply({
      amountMl,
      totalMl,
      goalMl: Number.isFinite(rawGoal) ? rawGoal : null,
      occurredAtLabel: formatReplyDateTime(occurredAt, timeZone),
      totalLabel: sameDay(occurredAt, today, timeZone) ? "Total de hoje" : `Total de ${dateKey.split("-").reverse().join("/")}`,
    });
  } catch {
    return buildWhatsAppWaterLoggedReplyMessage({
      amountLabel: formatNumber(amountMl),
      occurredAtLabel: formatReplyDateTime(occurredAt, timeZone),
    });
  }
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

export async function handleWaterIntent(userId: number, text: string, receivedAt: Date, amountMl: number, timeZone: string): Promise<WhatsappIntentResult> {
  const occurredAt = resolveRelativeOccurredAt(text, receivedAt, timeZone);
  const created = await createWaterLog(userId, {
    amountMl,
    occurredAt: occurredAt.toISOString(),
  });

  return {
    handled: true,
    action: "water_logged",
    reply: await buildWaterReply(userId, amountMl, occurredAt, timeZone),
    eventType: "whatsapp.intent.water_logged",
    detail: `Consumo de ${amountMl} ml de água registrado após interpretação de data relativa pelo WhatsApp.`,
    data: {
      waterLogId: created.id,
      amountMl,
      occurredAt: occurredAt.toISOString(),
    },
  };
}

function sumAvailable(values: Array<number | null | undefined>) {
  if (!values.length || values.some(value => typeof value !== "number" || !Number.isFinite(value))) {
    return null;
  }
  return values.reduce((total, value) => total + Number(value), 0);
}

async function buildCanonicalPeriodData(userId: number, period: PeriodRange, timeZone: string) {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { getPeriodReportBundle } = await import("../../insights/service");
    const bundle = await getPeriodReportBundle(userId, {
      startDate: getDateKeyInTimeZone(period.start, timeZone),
      endDate: getDateKeyInTimeZone(period.end, timeZone),
    });

    return {
      mealCount: bundle.mealsByDate.reduce((count, group) => count + group.items.length, 0),
      progressLines: buildWhatsAppCanonicalPeriodProgressLines({
        effectiveGoalCalories: sumAvailable(bundle.daily.map(day => day.adjustedGoalCalories)),
        exerciseCalories: sumAvailable(bundle.daily.map(day => day.exerciseCalories)),
        targetProteinGrams: sumAvailable(bundle.daily.map(day => day.goalProtein)),
        targetCarbsGrams: sumAvailable(bundle.daily.map(day => day.goalCarbs)),
        targetFatGrams: sumAvailable(bundle.daily.map(day => day.goalFat)),
        consumedCalories: bundle.totals.calories,
        consumedProteinGrams: bundle.totals.protein,
        consumedCarbsGrams: bundle.totals.carbs,
        consumedFatGrams: bundle.totals.fat,
      }),
    };
  } catch {
    return null;
  }
}

export async function handlePeriodReportIntent(userId: number, period: PeriodRange, timeZone: string): Promise<WhatsappIntentResult> {
  const meals = await listMeals(userId);
  const mealsInPeriod = meals.filter(meal => isMealInsidePeriod(meal, period));
  const canonical = await buildCanonicalPeriodData(userId, period, timeZone);

  const consumedCalories = mealsInPeriod.reduce((total, meal) => {
    const itemTotals = sumMealItems(toMealItemInputs(meal.items));
    return total + itemTotals.calories;
  }, 0);
  const goalSummaryLines = canonical?.progressLines
    ?? buildWhatsAppCanonicalPeriodProgressLines({
      effectiveGoalCalories: null,
      consumedCalories: Math.round(consumedCalories),
    });

  const reply = buildWhatsAppPeriodReportReplyMessage({
    periodLabel: period.label,
    mealCount: canonical?.mealCount ?? mealsInPeriod.length,
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
      mealCount: canonical?.mealCount ?? mealsInPeriod.length,
    },
  };
}
