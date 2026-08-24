import { DEFAULT_APP_TIME_ZONE } from "../../../shared/timeZone";
import { buildWhatsAppClarificationReplyMessage } from "./replyMessages";
import { handleMealItemMultiIncrement } from "./intent/gramsAdjustmentHandlers";
import { parseMixedMealItemIncrementCommand } from "./intent/mixedIncrementParser";
import { continueMixedMealItemIncrementPlan } from "./mixedMealItemIncrementPlan";
import type { WhatsappIntentResult } from "./intent/types";

export async function executeWhatsappGramsIncrementIntent(
  userId: number,
  input: {
    text?: string | null;
    receivedAt?: Date;
    userTimezone?: string;
    messageId?: string | null;
  },
): Promise<WhatsappIntentResult | null> {
  const text = input.text?.trim();
  const parsed = text ? parseMixedMealItemIncrementCommand(text) : null;
  if (!parsed) return null;

  if (parsed.unparsedSegments.length) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(
        "Não consegui interpretar todas as quantidades desse ajuste. Nada foi alterado; informe cada quantidade com g, ml, fatia ou unidade.",
      ),
      eventType: "whatsapp.intent.meal_item_increment_parse_incomplete",
      detail: "Comando de incremento bloqueado porque nem todos os segmentos quantitativos foram interpretados.",
      data: {
        parsedOperationCount: parsed.operations.length,
        unparsedSegmentCount: parsed.unparsedSegments.length,
      },
    };
  }

  const onlyMassOrVolume = parsed.operations.every(
    operation => operation.unit === "g" || operation.unit === "ml",
  );
  if (onlyMassOrVolume) {
    const result = await handleMealItemMultiIncrement(
      userId,
      parsed.operations.map(operation => ({
        gramsDelta: operation.quantity,
        targetFood: operation.targetFood,
      })),
      {
        mealLabel: parsed.mealLabel,
        timeZone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
      },
    );
    if (result.action !== "meal_item_grams_adjusted") return result;
    const adjustments = Array.isArray(result.data?.adjustments)
      ? result.data.adjustments
      : [];
    return {
      ...result,
      reply: result.reply.includes("recalculei os macros")
        ? result.reply
        : `${result.reply}\n\nTambém recalculei os macros da refeição.`,
      data: { ...result.data, increments: adjustments },
    };
  }

  return continueMixedMealItemIncrementPlan(userId, {
    contractVersion: 1,
    originalText: text ?? "",
    mealLabel: parsed.mealLabel,
    timeZone: input.userTimezone ?? DEFAULT_APP_TIME_ZONE,
    operations: parsed.operations.map(operation => ({
      targetFood: operation.targetFood,
      quantity: operation.quantity,
      unit: operation.unit,
      inheritedUnit: operation.inheritedUnit,
    })),
  });
}

export const contextUsage: import("./intentContext").IntentContextUsage = {
  usesRecentWindow: false,
  usesSummary: false,
  usesPendingOperation: true,
  usesLongTermMemory: false,
  requiresFreshDbQuery: true,
};
