import { createHash } from "node:crypto";
import {
  handleCoffeeSugarRegistrationIntent,
  isCoffeeSugarRegistrationText,
} from "./coffeeSugarIntent";
import { executeWhatsappContextualFoodReplacementIntent } from "./contextualFoodReplacementIntent";
import { executeWhatsappDeleteIntent } from "./deleteIntent";
import { handleWhatsappFoodClarification } from "./foodClarification";
import { attachWhatsappFoodClarificationPresentation } from "./foodClarificationPresentation";
import { getCurrentWhatsappInboundExternalMessageId } from "./inboundCorrelationContext";
import {
  handleCoffeeAdditionIntent,
  handleCoffeeLorCapsuleIntent,
  handleFoodAdditionIntent,
} from "./intent/foodAdditionHandlers";
import { parseReportPeriod } from "./intent/dateTime";
import { handleFoodReplacementIntents } from "./intent/foodReplacementHandlers";
import {
  handleMealItemMultiAdjustment,
  handleMealItemMultiIncrement,
  handleMealItemReplacement,
  handleQuantityCorrectionIntent,
} from "./intent/gramsAdjustmentHandlers";
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
import type { WhatsappIntentInput, WhatsappIntentResult } from "./intent/types";
import {
  handlePeriodReportIntent,
  handleSnackSuggestionIntent,
  handleWaterIntent,
} from "./intent/waterAndReportHandlers";
import { createWhatsappMealIntentDecisionInteraction } from "./mealIntentDecisionInteraction";
import { buildWhatsAppClarificationReplyMessage } from "./replyMessages";
import { getWhatsAppUserTimeZone } from "./userMeasurementReplyContext";

export type { WhatsappIntentResult, WhatsappIntentInput } from "./intent/types";

const WHATSAPP_INTENT_ACTIONS = new Set<WhatsappIntentResult["action"]>([
  "water_logged",
  "meal_item_added",
  "meal_item_grams_adjusted",
  "meal_item_replaced",
  "meal_suggestion",
  "period_report",
  "clarification_needed",
  "meal_deleted",
  "meal_item_deleted",
  "delete_cancelled",
  "food_clarification_requested",
  "food_clarification_completed",
  "food_clarification_reprompted",
  "food_clarification_cancelled",
  "food_clarification_unavailable",
  "food_clarification_retryable_failure",
  "food_clarification_blocked",
  "food_clarification_standalone_command_blocked",
]);

function normalizePendingGateResult(result: {
  action?: string;
  reply: string;
  eventType: string;
  detail: string;
  data?: Record<string, unknown>;
  interactiveReply?: import("./replyContract").WhatsAppLogicalReply;
}): WhatsappIntentResult {
  const action =
    result.action &&
    WHATSAPP_INTENT_ACTIONS.has(result.action as WhatsappIntentResult["action"])
      ? (result.action as WhatsappIntentResult["action"])
      : "clarification_needed";
  return {
    handled: true,
    action,
    reply: result.reply,
    eventType: result.eventType,
    detail: result.detail,
    ...(result.data ? { data: result.data } : {}),
    ...(result.interactiveReply
      ? { interactiveReply: result.interactiveReply }
      : {}),
  };
}

async function resolvePendingInteractionBeforeTextIntent(
  userId: number,
  input: WhatsappIntentInput,
  text: string,
  receivedAt: Date,
  userTimeZone: string
): Promise<WhatsappIntentResult | null> {
  const correlatedMessageId =
    input.messageId?.trim() ||
    getCurrentWhatsappInboundExternalMessageId()?.trim() ||
    null;
  const requestScopedInbound =
    !input.entrypoint && Boolean(correlatedMessageId);

  if (input.entrypoint !== "audioTranscription" && !requestScopedInbound)
    return null;

  const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");
  const gate = await resolveWhatsAppPrecedenceGate({
    userId,
    text,
    receivedAt,
    userTimezone: userTimeZone,
    messageId: correlatedMessageId,
    pendingOnly: true,
  });
  if (gate.step === "continue_pipeline") return null;
  return normalizePendingGateResult(gate.result);
}

function withCanonicalGramsMetadata(
  result: WhatsappIntentResult
): WhatsappIntentResult {
  if (result.action !== "meal_item_grams_adjusted") return result;
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
  messageId?: string | null
) {
  const externalMessageId =
    messageId?.trim() || getCurrentWhatsappInboundExternalMessageId()?.trim();
  if (externalMessageId) return externalMessageId;
  const digest = createHash("sha256")
    .update(`${userId}|${receivedAt.toISOString()}|${text}`)
    .digest("hex")
    .slice(0, 32);
  return `derived:${digest}`;
}

function buildFoodMutationContext(
  userId: number,
  input: WhatsappIntentInput,
  text: string,
  receivedAt: Date
) {
  return {
    originalText: text,
    receivedAt,
    messageId: resolveInboundCorrelationId(
      userId,
      text,
      receivedAt,
      input.messageId
    ),
  };
}

function isLatestFoodCorrectionText(text: string) {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\b(?:ultimo|ultima)\s+(?:alimento|item|refeicao)\b/.test(normalized);
}

function looksLikeMealIntentDecisionText(text: string) {
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  if (/\b(?:almocei|jantei|comi|lanchei|ceei|tomei|bebi|registrei|registrar|registre|adicionar|adicione|inclua|lance|lancar)\b/.test(normalized)) {
    return false;
  }
  if (/\b(o que|oque)\s+(?:eu\s+)?(?:posso\s+)?comer\b/.test(normalized)
    || /\b(?:posso|devo)\s+comer\b/.test(normalized)
    || /\b(?:sugestao|sugira|sugerir|dica|ideia|orientacao|recomenda|recomende|indicacao|indique|monte|monta|montar)\b/.test(normalized)) {
    return false;
  }
  return /\b(?:cafe da manha|cafe|almoco|jantar|lanche|ceia)\b(?:\s+[a-z0-9]+){0,3}\s+com\s+\S+/.test(normalized);
}

async function executeResumedFoodRegistration(
  userId: number,
  input: WhatsappIntentInput,
  text: string,
  receivedAt: Date,
  userTimeZone: string
): Promise<WhatsappIntentResult | null> {
  const coffeeCapsule = parseCoffeeLorCapsuleIntent(text);
  if (coffeeCapsule)
    return handleCoffeeLorCapsuleIntent(
      userId,
      text,
      coffeeCapsule,
      receivedAt,
      userTimeZone
    );

  const coffeeAddition = parseCoffeeAdditionIntent(text);
  if (coffeeAddition)
    return handleCoffeeAdditionIntent(
      userId,
      text,
      coffeeAddition,
      receivedAt,
      userTimeZone
    );

  const foodClarification = await handleWhatsappFoodClarification({
    userId,
    text,
    receivedAt,
    userTimezone: userTimeZone,
    messageId: resolveInboundCorrelationId(
      userId,
      text,
      receivedAt,
      input.messageId
    ),
  });
  if (foodClarification) {
    return attachWhatsappFoodClarificationPresentation(
      userId,
      foodClarification,
      receivedAt
    );
  }

  const foodAddition = parseFoodAdditionIntent(text, receivedAt);
  return foodAddition
    ? handleFoodAdditionIntent(
        userId,
        foodAddition,
        userTimeZone,
        buildFoodMutationContext(userId, input, text, receivedAt)
      )
    : null;
}

export async function executeWhatsappTextIntent(
  userId: number,
  input: WhatsappIntentInput
): Promise<WhatsappIntentResult | null> {
  const text = input.text?.trim();
  if (!text) return null;

  const receivedAt = input.receivedAt ?? new Date();
  const userTimeZone =
    input.userTimezone ?? (await getWhatsAppUserTimeZone(userId));

  if (input.entrypoint === "intentClarification.resume") {
    return executeResumedFoodRegistration(
      userId,
      input,
      text,
      receivedAt,
      userTimeZone
    );
  }

  const pendingInteraction = await resolvePendingInteractionBeforeTextIntent(
    userId,
    input,
    text,
    receivedAt,
    userTimeZone
  );
  if (pendingInteraction) return pendingInteraction;

  if (isCoffeeSugarRegistrationText(text)) {
    return handleCoffeeSugarRegistrationIntent({
      userId,
      text,
      receivedAt,
      userTimezone: userTimeZone,
      messageId: resolveInboundCorrelationId(
        userId,
        text,
        receivedAt,
        input.messageId
      ),
    });
  }

  if (looksLikeMealIntentDecisionText(text)) {
    return createWhatsappMealIntentDecisionInteraction({
      userId,
      originalText: text,
      receivedAt,
      messageId: input.messageId,
    });
  }

  if (isLatestFoodCorrectionText(text)) {
    const contextualFoodReplacement =
      await executeWhatsappContextualFoodReplacementIntent(userId, {
        text,
        receivedAt,
        userTimezone: userTimeZone,
      });
    if (contextualFoodReplacement) {
      return {
        handled: true,
        action: contextualFoodReplacement.action,
        reply: contextualFoodReplacement.reply,
        eventType: contextualFoodReplacement.eventType,
        detail: contextualFoodReplacement.detail,
        ...(contextualFoodReplacement.data
          ? { data: contextualFoodReplacement.data }
          : {}),
        ...(contextualFoodReplacement.interactiveReply
          ? { interactiveReply: contextualFoodReplacement.interactiveReply }
          : {}),
      };
    }
  }

  const deleteIntent = await executeWhatsappDeleteIntent(userId, {
    text,
    receivedAt,
    timeZone: userTimeZone,
    entrypoint: input.entrypoint ?? "executeWhatsappTextIntent",
  });
  if (deleteIntent) return deleteIntent;

  const waterIntent = parseWaterIntent(text);
  if (waterIntent?.kind === "clarification") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(
        "Entendi que você quer registrar água, mas preciso da quantidade. Exemplo: 500 ml de água ontem."
      ),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de água sem quantidade explícita.",
    };
  }
  if (waterIntent?.kind === "water") {
    return handleWaterIntent(
      userId,
      text,
      receivedAt,
      waterIntent.amountMl,
      userTimeZone
    );
  }

  const quantityCorrection = parseQuantityCorrectionIntent(text, receivedAt);
  if (quantityCorrection)
    return handleQuantityCorrectionIntent(userId, quantityCorrection);

  const gramsReplacement = parseMealItemGramsReplacement(text);
  if (gramsReplacement)
    return handleMealItemReplacement(userId, gramsReplacement, userTimeZone);

  const coffeeCapsule = parseCoffeeLorCapsuleIntent(text);
  if (coffeeCapsule)
    return handleCoffeeLorCapsuleIntent(
      userId,
      text,
      coffeeCapsule,
      receivedAt,
      userTimeZone
    );

  const coffeeAddition = parseCoffeeAdditionIntent(text);
  if (coffeeAddition)
    return handleCoffeeAdditionIntent(
      userId,
      text,
      coffeeAddition,
      receivedAt,
      userTimeZone
    );

  const foodClarification = await handleWhatsappFoodClarification({
    userId,
    text,
    receivedAt,
    userTimezone: userTimeZone,
    messageId: resolveInboundCorrelationId(
      userId,
      text,
      receivedAt,
      input.messageId
    ),
  });
  if (foodClarification) {
    return attachWhatsappFoodClarificationPresentation(
      userId,
      foodClarification,
      receivedAt
    );
  }

  const foodAddition = parseFoodAdditionIntent(text, receivedAt);
  if (foodAddition)
    return handleFoodAdditionIntent(
      userId,
      foodAddition,
      userTimeZone,
      buildFoodMutationContext(userId, input, text, receivedAt)
    );

  const gramsIncrements = parseMealItemGramsIncrementMulti(text);
  if (gramsIncrements) {
    return withCanonicalGramsMetadata(
      await handleMealItemMultiIncrement(userId, gramsIncrements, {
        timeZone: userTimeZone,
      })
    );
  }

  const gramsAdjustments = parseMealItemGramsAdjustmentMulti(text);
  if (gramsAdjustments) {
    return withCanonicalGramsMetadata(
      await handleMealItemMultiAdjustment(userId, gramsAdjustments, {
        timeZone: userTimeZone,
      })
    );
  }

  const foodReplacements = parseFoodReplacementIntents(text);
  if (foodReplacements)
    return handleFoodReplacementIntents(
      userId,
      foodReplacements,
      userTimeZone,
      buildFoodMutationContext(userId, input, text, receivedAt)
    );

  if (parseSnackSuggestionIntent(text)) return handleSnackSuggestionIntent();

  const reportPeriod = parseReportPeriod(text, receivedAt, userTimeZone);
  if (!reportPeriod) return null;
  if ("kind" in reportPeriod) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: buildWhatsAppClarificationReplyMessage(
        "Posso montar um resumo. Me diga o período, por exemplo: hoje, ontem, semana, mês ou 01/06 a 03/06."
      ),
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de relatório sem período explícito.",
    };
  }

  return handlePeriodReportIntent(userId, reportPeriod, userTimeZone);
}
