export {
  buildIntentHintFromInterpretation,
  type WhatsappLlmNutritionFallback,
} from "./llmIntentActionsLegacy";

import {
  executeWhatsappLlmIntent as executeLegacyWhatsappLlmIntent,
} from "./llmIntentActionsLegacy";
import {
  persistWhatsappReusablePreparationPreferenceFromText,
} from "./personalPreparationPreference";
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
  const itemText = normalized
    .replace(/\bcafe da manha\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\bcafe\b/.test(itemText)) return false;
  return !/\bcafe\b[^,.;]*\b(?:leite|mel|creme|chantilly|condensad[oa]|chocolate|cacau)\b/.test(itemText);
}

export async function executeWhatsappLlmIntent(
  userId: number,
  input: StructuredCoffeeIntentInput,
) {
  const reusablePreference = await persistWhatsappReusablePreparationPreferenceFromText({
    userId,
    text: input.text,
    createdAt: input.receivedAt,
  });
  if (reusablePreference) {
    if (!reusablePreference.persisted || !reusablePreference.memory) {
      return {
        handled: true as const,
        action: "clarification_needed" as const,
        reply: "Entendi que isso é uma preferência sua, mas não consegui salvá-la com segurança agora. Não vou assumir esse preparo nas próximas refeições.",
        eventType: "whatsapp.context_memory.preference_persistence_unavailable",
        detail: "Sinal explícito de preferência recorrente reconhecido, mas a memória durável não pôde ser confirmada.",
        data: {
          preferenceRecognized: true,
          preferencePersisted: false,
        },
      };
    }
    return {
      handled: true as const,
      action: "preference_recorded" as const,
      reply: reusablePreference.choice === "without_sugar"
        ? `Entendido. Vou considerar ${reusablePreference.subject} sem açúcar quando você não informar outro preparo.`
        : `Entendido. Vou considerar ${reusablePreference.subject} com açúcar quando você não informar outro preparo.`,
      eventType: "whatsapp.context_memory.preference_recorded",
      detail: `Preferência pessoal estruturada persistida como memória ${reusablePreference.memory.id} (${reusablePreference.memory.key}).`,
      data: {
        preferenceRecognized: true,
        preferencePersisted: true,
        contextMemoryId: reusablePreference.memory.id,
        contextMemoryKey: reusablePreference.memory.key,
        preparationChoice: reusablePreference.choice,
      },
    };
  }

  if (shouldRunCoffeePreparationPreflight(input.text)) {
    const coffeePreflight = await tryExecuteWhatsappStructuredCoffeeIntent(userId, input);
    if (coffeePreflight.matched) return coffeePreflight.result;
  }
  return executeLegacyWhatsappLlmIntent(userId, input);
}
