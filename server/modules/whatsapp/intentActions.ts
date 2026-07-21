import { createHash } from "node:crypto";
import { buildWhatsAppClarificationReplyMessage } from "./replyMessages";
import { executeWhatsappDeleteIntent } from "./deleteIntent";
import { handleWhatsappFoodClarification } from "./foodClarification";
import { handleCoffeeAdditionIntent, handleCoffeeLorCapsuleIntent, handleFoodAdditionIntent } from "./intent/foodAdditionHandlers";
import { handleFoodReplacementIntents } from "./intent/foodReplacementHandlers";
import {
  handleMealItemMultiAdjustment,
  handleMealItemMultiIncrement,
  handleMealItemReplacement,
  handleQuantityCorrectionIntent,
} from "./intent/gramsAdjustmentHandlers";
import { handlePeriodReportIntent, handleSnackSuggestionIntent, handleWaterIntent } from "./intent/waterAndReportHandlers";
import {
  parseCoffeeAdditionIntent,
  parseCoffeeLorCapsuleIntent,
  parseFoodAdditionIntent,
  parseFoodReplacementIntents,
  parseMealItemGramsAdjustmentMulti,
  parseMealItemGramsIncrementMulti,
  parseMealItemGramsReplacement,
  parseQuantityCorrectionIntent,
  parseSnackSuggestionIntent,
  parseWaterIntent,
} from "./intent/parsers";
import { parseReportPeriod } from "./intent/dateTime";
import type { WhatsappIntentInput, WhatsappIntentResult } from "./intent/types";
import { getWhatsAppUserTimeZone } from "./userMeasurementReplyContext";

export type { WhatsappIntentResult, WhatsappIntentInput } from "./intent/types";

function withCanonicalGramsMetadata(result: WhatsappIntentResult): WhatsappIntentResult {
  if (result.action !== "meal_item_grams_adjusted") {
    return result;
  }
  return {
    ...result,
    reply: result.reply.includes("recalculei os macros")
      ? result.reply
      : `${result.reply}\n\nTambém recalculei os macros da refeição.`,
    detail: result.detail.includes("Escopo da busca:")
      ? result.detail
      : `${result.detail} Escopo da busca: nas refeições do dia.`,
  };
}

function resolveInboundCorrelationId(
  userId: number,
  text: string,
  receivedAt: Date,
  messageId?: string | null,
) {
  if (messageId?.trim()) return messageId.trim();
  const digest = createHash("sha256")
    .update(`${userId}|${receivedAt.toISOString()}|${text}`)
    .digest("hex")
    .slice(0, 32);
  return `derived:${digest}`;
}

export async function executeWhatsappTextIntent(userId: number, input: WhatsappIntentInput): Promise<WhatsappIntentResult | null> {
  const text = input.text?.trim();
  if (!text) {
    return null;
  }

  const receivedAt = input.receivedAt ?? new Date();
  const userTimeZone = input.userTimezone ?? await getWhatsAppUserTimeZone(userId);

  const deleteIntent = await executeWhatsappDeleteIntent(userId, {
    text,
    receivedAt,
    timeZone: userTimeZone,
    entrypoint: input.entrypoint ?? "executeWhatsappTextIntent",
  });
  if (deleteIntent) {
    return deleteIntent;
  }

  const waterIntent = parseWaterIntent(text);
  if (waterIntent?.kind === "clarification") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage("Entendi que você quer registrar água, mas preciso da quantidade. Exemplo: 500 ml de água ontem."),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de água sem quantidade explícita.",
    };
  }
  if (waterIntent?.kind === "water") {
    return handleWaterIntent(userId, text, receivedAt, waterIntent.amountMl, userTimeZone);
  }

  const quantityCorrection = parseQuantityCorrectionIntent(text, receivedAt);
  if (quantityCorrection) {
    return handleQuantityCorrectionIntent(userId, quantityCorrection);
  }

  const gramsReplacement = parseMealItemGramsReplacement(text);
  if (gramsReplacement) {
    return handleMealItemReplacement(userId, gramsReplacement, userTimeZone);
  }

  // Parsers alimentares especializados mantêm precedência para não transformar
  // entradas já inequívocas, como "1 café lor", em pergunta genérica (#855).
  const coffeeCapsule = parseCoffeeLorCapsuleIntent(text);
  if (coffeeCapsule) {
    return handleCoffeeLorCapsuleIntent(userId, text, coffeeCapsule, receivedAt, userTimeZone);
  }

  const coffeeAddition = parseCoffeeAdditionIntent(text);
  if (coffeeAddition) {
    return handleCoffeeAdditionIntent(userId, text, coffeeAddition, receivedAt, userTimeZone);
  }

  // A clarificação persistente antecede o parser alimentar genérico. Assim uma
  // contagem sem porção canônica segura preserva o alimento original e pede
  // somente o dado ausente, enquanto frases completas com unidade continuam no
  // pipeline normal. Quando o wrapper não repassa o ID externo, a chave derivada
  // mantém um vínculo idempotente estável com o inbound real ou transcrito.
  const foodClarification = await handleWhatsappFoodClarification({
    userId,
    text,
    receivedAt,
    userTimezone: userTimeZone,
    messageId: resolveInboundCorrelationId(userId, text, receivedAt, input.messageId),
  });
  if (foodClarification) {
    return foodClarification;
  }

  const foodAddition = parseFoodAdditionIntent(text, receivedAt);
  if (foodAddition) {
    return handleFoodAdditionIntent(userId, foodAddition, userTimeZone);
  }

  const gramsIncrements = parseMealItemGramsIncrementMulti(text);
  if (gramsIncrements) {
    return withCanonicalGramsMetadata(await handleMealItemMultiIncrement(userId, gramsIncrements, { timeZone: userTimeZone }));
  }

  const gramsAdjustments = parseMealItemGramsAdjustmentMulti(text);
  if (gramsAdjustments) {
    return withCanonicalGramsMetadata(await handleMealItemMultiAdjustment(userId, gramsAdjustments, { timeZone: userTimeZone }));
  }

  const foodReplacements = parseFoodReplacementIntents(text);
  if (foodReplacements) {
    return handleFoodReplacementIntents(userId, foodReplacements, userTimeZone);
  }

  if (parseSnackSuggestionIntent(text)) {
    return handleSnackSuggestionIntent();
  }

  const reportPeriod = parseReportPeriod(text, receivedAt, userTimeZone);
  if (!reportPeriod) {
    return null;
  }
  if ("kind" in reportPeriod) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage("Posso montar um resumo. Me diga o período, por exemplo: hoje, ontem, semana, mês ou 01/06 a 03/06."),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de relatório sem período explícito.",
    };
  }

  return handlePeriodReportIntent(userId, reportPeriod, userTimeZone);
}
