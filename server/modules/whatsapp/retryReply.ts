import { listUserMeals, listUserWaterLogs, listUserWeightEntries } from "../../db";
import type { WhatsAppMessageDomainLinkRecord } from "../../repositories/whatsappConversationRepository";
import {
  buildWhatsAppConsolidatedMealReplyMessage,
  buildWhatsAppWaterLoggedReplyMessage,
  buildWhatsAppWeightLoggedReplyMessage,
} from "./replyMessages";
import { getWhatsAppMealGoalProgress } from "./goalProgressService";
import { getWhatsAppWaterProgress, getWhatsAppWeightVariation } from "./userMeasurementReplyContext";
import { formatWhatsAppNumber } from "./replyTemplates";

export type WhatsAppRetryReply = {
  replyText: string;
  mealId?: number | null;
};

function uniquePositiveIds(values: Array<number | null | undefined>) {
  return [...new Set(values.filter((value): value is number => typeof value === "number" && value > 0))];
}

function formatOccurredAt(value: Date | number | string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/**
 * Reconstrói uma resposta funcional exclusivamente a partir dos vínculos de
 * domínio já persistidos para o mesmo inbound. É usado no retry de transporte
 * para nunca repetir a mutação de refeição ou hidratação.
 */
export async function buildWhatsAppRetryReply(
  userId: number,
  links: WhatsAppMessageDomainLinkRecord[],
  fallbackOccurredAt: Date,
): Promise<WhatsAppRetryReply | null> {
  const mealIds = uniquePositiveIds(links.map(link => link.mealId));
  const waterLogIds = uniquePositiveIds(links.map(link => link.waterLogId));
  const weightEntryIds = uniquePositiveIds(links.map(link => link.weightEntryId));
  if (!mealIds.length && !waterLogIds.length && !weightEntryIds.length) return null;

  const blocks: string[] = [];

  if (waterLogIds.length) {
    const waterLogs = await listUserWaterLogs(userId);
    const linkedLogs = waterLogs.filter(log => waterLogIds.includes(log.id));
    if (linkedLogs.length) {
      const amountMl = linkedLogs.reduce((total, log) => total + Number(log.amountMl ?? 0), 0);
      const occurredAt = new Date(Math.max(...linkedLogs.map(log => new Date(log.occurredAt).getTime())));
      const progress = await getWhatsAppWaterProgress(userId, occurredAt);
      blocks.push(buildWhatsAppWaterLoggedReplyMessage({
        amountLabel: formatWhatsAppNumber(amountMl),
        occurredAtLabel: formatOccurredAt(occurredAt),
        totalMl: progress.totalMl,
        goalMl: progress.goalMl,
      }));
    }
  }

  if (weightEntryIds.length) {
    const weightEntries = await listUserWeightEntries(userId);
    for (const entryId of weightEntryIds) {
      const entry = weightEntries.find(candidate => candidate.id === entryId);
      if (!entry) continue;
      const occurredAt = new Date(entry.measuredAt ?? fallbackOccurredAt);
      const { variationKg } = await getWhatsAppWeightVariation(userId, occurredAt, Number(entry.weightKg));
      blocks.push(buildWhatsAppWeightLoggedReplyMessage({
        weightLabel: formatWhatsAppNumber(Number(entry.weightKg)),
        occurredAtLabel: formatOccurredAt(occurredAt),
        variationLabel: variationKg === null
          ? "primeiro registro"
          : `${variationKg > 0 ? "+" : ""}${formatWhatsAppNumber(variationKg)} kg`,
      }));
    }
  }

  if (mealIds.length) {
    const meals = await listUserMeals(userId);
    for (const mealId of mealIds) {
      const meal = meals.find(candidate => candidate.id === mealId);
      if (!meal) continue;
      const occurredAt = new Date(meal.occurredAt ?? fallbackOccurredAt);
      const goalProgress = await getWhatsAppMealGoalProgress(userId, occurredAt);
      blocks.push(buildWhatsAppConsolidatedMealReplyMessage(meal, {
        registeredAt: occurredAt,
        goalProgress,
      }));
    }
  }

  if (!blocks.length) return null;
  return {
    replyText: blocks.join("\n\n"),
    mealId: mealIds.length === 1 ? mealIds[0] : null,
  };
}
