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

export async function executeWhatsappLlmIntent(
  userId: number,
  input: StructuredCoffeeIntentInput,
) {
  const coffeePreflight = await tryExecuteWhatsappStructuredCoffeeIntent(userId, input);
  if (coffeePreflight.matched) return coffeePreflight.result;
  return executeLegacyWhatsappLlmIntent(userId, input);
}
