import { createHash } from "node:crypto";
import { logInferenceEvent } from "../../db";
import type { WhatsappIntentContext } from "./intentContext";
import { interpretWhatsappMessageWithDiagnostics } from "./intentInterpreter";
import type { WhatsappInterpretedIntent } from "./intentSchema";
import type { WhatsappContextFlow } from "./conversationContextRollout";

function normalizeValue(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim() || null;
}

function buildTargetShape(intent: WhatsappInterpretedIntent) {
  return {
    intent: intent.intent,
    date: normalizeValue(intent.date),
    meal: intent.meal
      ? { label: normalizeValue(intent.meal.label), createIfMissing: intent.meal.createIfMissing }
      : null,
    sourceFood: normalizeValue(intent.sourceFood),
    targetFood: normalizeValue(intent.targetFood),
    quantity: intent.quantity
      ? { value: intent.quantity.value, unit: normalizeValue(intent.quantity.unit) }
      : null,
    items: intent.items.map(item => ({
      foodName: normalizeValue(item.foodName),
      quantity: item.quantity ?? null,
      unit: normalizeValue(item.unit),
      brand: normalizeValue(item.brand),
      preparation: normalizeValue(item.preparation),
    })),
  };
}

function hashTarget(intent: WhatsappInterpretedIntent) {
  return createHash("sha256")
    .update(JSON.stringify(buildTargetShape(intent)))
    .digest("hex")
    .slice(0, 16);
}

export function isShadowIntentComparisonEnabled() {
  return process.env.WHATSAPP_CONTEXT_SHADOW_COMPARE_INTENT?.trim().toLowerCase() === "true";
}

export async function compareWhatsappIntentInShadow(input: {
  userId: number;
  text: string;
  flow: WhatsappContextFlow;
  legacyContext: WhatsappIntentContext;
  persistentContext: WhatsappIntentContext;
}) {
  try {
    const [legacy, persistent] = await Promise.all([
      interpretWhatsappMessageWithDiagnostics(input.text, input.legacyContext),
      interpretWhatsappMessageWithDiagnostics(input.text, input.persistentContext),
    ]);
    const legacyTargetHash = hashTarget(legacy.intent);
    const persistentTargetHash = hashTarget(persistent.intent);
    const sameIntent = legacy.intent.intent === persistent.intent.intent;
    const sameTarget = legacyTargetHash === persistentTargetHash;
    const sameConfirmation = legacy.intent.requiresConfirmation === persistent.intent.requiresConfirmation;
    const equivalent = sameIntent && sameTarget && sameConfirmation;

    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: equivalent ? "success" : "warning",
      eventType: equivalent
        ? "whatsapp.history.shadow_intent_equivalent"
        : "whatsapp.history.shadow_intent_divergence",
      detail: JSON.stringify({
        flow: input.flow,
        sameIntent,
        sameTarget,
        sameConfirmation,
        legacyIntent: legacy.intent.intent,
        persistentIntent: persistent.intent.intent,
        legacyTargetHash,
        persistentTargetHash,
        legacySource: legacy.source,
        persistentSource: persistent.source,
        legacyValidationStatus: legacy.validationStatus,
        persistentValidationStatus: persistent.validationStatus,
      }),
    });
  } catch (error) {
    logInferenceEvent({
      userId: input.userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.history.shadow_intent_comparison_failed",
      detail: JSON.stringify({
        flow: input.flow,
        errorType: error instanceof Error ? error.name : "unknown",
      }),
    });
  }
}
