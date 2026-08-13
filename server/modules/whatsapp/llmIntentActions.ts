export {
  buildIntentHintFromInterpretation,
  type WhatsappLlmNutritionFallback,
} from "./llmIntentActionsLegacy";

import {
  executeWhatsappLlmIntent as executeLegacyWhatsappLlmIntent,
} from "./llmIntentActionsLegacy";
import {
  resumeWhatsappStructuredCoffeePreparation,
  tryExecuteWhatsappStructuredCoffeeIntent,
  type StructuredCoffeeIntentInput,
} from "./structuredCoffeeIntentActions";

export { resumeWhatsappStructuredCoffeePreparation };

function shouldRunCoffeePreparationPreflight(text?: string | null) {
  const normalized = text
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
  if (!/\b\d+(?:[,.]\d+)?\s*(?:xicaras?|copos?|ml|l)\s+(?:de\s+)?cafe\b/.test(normalized)) {
    return false;
  }
  return !/\bcafe\b[^,.;]*\b(?:leite|mel|creme|chantilly|condensad[oa]|chocolate|cacau)\b/.test(normalized);
}

export async function executeWhatsappLlmIntent(
  userId: number,
  input: StructuredCoffeeIntentInput,
) {
  if (shouldRunCoffeePreparationPreflight(input.text)) {
    const coffeePreflight = await tryExecuteWhatsappStructuredCoffeeIntent(userId, input);
    if (coffeePreflight.matched) return coffeePreflight.result;
  }
  return executeLegacyWhatsappLlmIntent(userId, input);
}
