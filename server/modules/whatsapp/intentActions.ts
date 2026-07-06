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

export type { WhatsappIntentResult, WhatsappIntentInput } from "./intent/types";

export async function executeWhatsappTextIntent(userId: number, input: WhatsappIntentInput): Promise<WhatsappIntentResult | null> {
  const text = input.text?.trim();
  if (!text) {
    return null;
  }

  const receivedAt = input.receivedAt ?? new Date();
  const waterIntent = parseWaterIntent(text);
  if (waterIntent?.kind === "clarification") {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Entendi que você quer registrar água, mas preciso da quantidade. Exemplo: 500 ml de água ontem.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de água sem quantidade explícita.",
    };
  }
  if (waterIntent?.kind === "water") {
    return handleWaterIntent(userId, text, receivedAt, waterIntent.amountMl);
  }

  const quantityCorrection = parseQuantityCorrectionIntent(text, receivedAt);
  if (quantityCorrection) {
    return handleQuantityCorrectionIntent(userId, quantityCorrection);
  }

  const gramsReplacement = parseMealItemGramsReplacement(text);
  if (gramsReplacement) {
    return handleMealItemReplacement(userId, gramsReplacement);
  }

  const coffeeCapsule = parseCoffeeLorCapsuleIntent(text);
  if (coffeeCapsule) {
    return handleCoffeeLorCapsuleIntent(userId, text, coffeeCapsule, receivedAt);
  }

  const coffeeAddition = parseCoffeeAdditionIntent(text);
  if (coffeeAddition) {
    return handleCoffeeAdditionIntent(userId, text, coffeeAddition, receivedAt);
  }

  const foodAddition = parseFoodAdditionIntent(text, receivedAt);
  if (foodAddition) {
    return handleFoodAdditionIntent(userId, foodAddition);
  }

  const gramsIncrements = parseMealItemGramsIncrementMulti(text);
  if (gramsIncrements) {
    return handleMealItemMultiIncrement(userId, gramsIncrements);
  }

  const gramsAdjustments = parseMealItemGramsAdjustmentMulti(text);
  if (gramsAdjustments) {
    return handleMealItemMultiAdjustment(userId, gramsAdjustments);
  }

  const foodReplacements = parseFoodReplacementIntents(text);
  if (foodReplacements) {
    return handleFoodReplacementIntents(userId, foodReplacements);
  }

  if (parseSnackSuggestionIntent(text)) {
    return handleSnackSuggestionIntent();
  }

  const reportPeriod = parseReportPeriod(text, receivedAt);
  if (!reportPeriod) {
    return null;
  }
  if ("kind" in reportPeriod) {
    return {
      handled: true,
      action: "clarification_needed",
      reply: "Posso montar um resumo. Me diga o período, por exemplo: hoje, ontem, semana, mês ou 01/06 a 03/06.",
      eventType: "whatsapp.intent.clarification_needed",
      detail: "Pedido de relatório sem período explícito.",
    };
  }

  return handlePeriodReportIntent(userId, reportPeriod);
}
