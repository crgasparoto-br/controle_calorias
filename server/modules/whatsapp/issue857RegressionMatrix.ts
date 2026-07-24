import { WHATSAPP_INTERACTION_REGISTRY } from "./interactionRegistry";

export type Issue857RegressionModality =
  | "text"
  | "callback"
  | "audio_transcription"
  | "simulator"
  | "image_context"
  | "standalone_outbound";

export type Issue857ScenarioEvidence = {
  file: string;
  requiredTokens: readonly string[];
};

export type Issue857RegressionEvidence = {
  interactionId: string;
  pendingType: string;
  classification: "open" | "closed";
  entrypoints: readonly string[];
  applicableModalities: readonly Issue857RegressionModality[];
  requiredBehaviors: readonly string[];
  scenarioEvidence: readonly Issue857ScenarioEvidence[];
};

const COMMON_TRANSPORT_EVIDENCE: readonly Issue857ScenarioEvidence[] = [
  {
    file: "server/modules/whatsapp/logicalReplyDelivery.test.ts",
    requiredTokens: ["lifecycle"],
  },
  {
    file: "server/modules/whatsapp/replyTransport.test.ts",
    requiredTokens: ["fallback", "effectiveOk"],
  },
];

const INTERACTION_SCENARIOS: Record<string, {
  modalities: readonly Issue857RegressionModality[];
  evidence: readonly Issue857ScenarioEvidence[];
}> = {
  "delete.confirmation": {
    modalities: ["text", "callback", "audio_transcription", "simulator", "image_context"],
    evidence: [
      { file: "server/modules/whatsapp/deleteIntent.canonicalProgress.test.ts", requiredTokens: ["confirm"] },
      { file: "server/modules/whatsapp/deleteIntent.confirmation.test.ts", requiredTokens: ["confirmation", "cancel"] },
      { file: "server/whatsappIntentWebhook.delete.test.ts", requiredTokens: ["Excluir", "Registrar"] },
      { file: "server/whatsappWebhook.audioTranscription.test.ts", requiredTokens: ["audio", "delete"] },
    ],
  },
  "delete.candidate_selection": {
    modalities: ["text", "callback", "audio_transcription", "simulator", "image_context"],
    evidence: [
      { file: "server/modules/whatsapp/deleteIntent.issue856.test.ts", requiredTokens: ["selection", "candidates"] },
      { file: "server/modules/whatsapp/deleteIntent.confirmation.test.ts", requiredTokens: ["candidateCount", "selection"] },
    ],
  },
  "meal_item.candidate_selection": {
    modalities: ["text", "callback", "audio_transcription", "simulator"],
    evidence: [
      { file: "server/modules/whatsapp/mealItemSelectionCallback.chained.test.ts", requiredTokens: ["select:0", "remainingSelections"] },
      { file: "server/modules/whatsapp/intentActions.quantityCorrection.test.ts", requiredTokens: ["interactiveReply", "quantity"] },
    ],
  },
  "generic_confirmation.confirm_cancel": {
    modalities: ["text", "callback", "audio_transcription", "simulator"],
    evidence: [
      { file: "server/modules/whatsapp/webhookTextCommands.test.ts", requiredTokens: ["confirm", "cancel"] },
    ],
  },
  "generic_confirmation.reclassify_scope": {
    modalities: ["text", "callback", "audio_transcription", "simulator"],
    evidence: [
      { file: "server/modules/whatsapp/webhookTextCommands.test.ts", requiredTokens: ["reclassify_recent_meals", "action_confirmation_requested"] },
    ],
  },
  "period_report.period_selection": {
    modalities: ["text", "callback", "audio_transcription", "simulator"],
    evidence: [
      { file: "server/modules/whatsapp/periodReportClarification.test.ts", requiredTokens: ["period", "cancel"] },
    ],
  },
  "professional_access.authorization": {
    modalities: ["text", "callback", "standalone_outbound"],
    evidence: [
      { file: "server/modules/whatsapp/messageRouter.interactiveCallback.test.ts", requiredTokens: ["authorizationMessage", "interactive_callback"] },
    ],
  },
  "meal_intent_decision.consume_or_suggest": {
    modalities: ["text", "callback", "audio_transcription", "simulator"],
    evidence: [
      {
        file: "server/modules/whatsapp/mealIntentDecisionInteraction.test.ts",
        requiredTokens: [
          "Registrar alimento",
          "interactive_callback",
          "originalText",
          "audioTranscription",
          "simulador",
        ],
      },
      {
        file: "server/modules/whatsapp/foodAssistant.test.ts",
        requiredTokens: ["segunda clarificação", "Nada foi registrado como consumo"],
      },
    ],
  },
  "meal_intent_decision.registration_details": {
    modalities: ["text", "audio_transcription", "simulator"],
    evidence: [
      {
        file: "server/modules/whatsapp/confirmedMealRegistration.test.ts",
        requiredTokens: [
          "Qual foi a quantidade de açúcar?",
          "substitui a clarificação complementar",
          "continue_pipeline",
        ],
      },
    ],
  },
  "intent_clarification.generic": {
    modalities: ["text", "callback", "audio_transcription", "simulator"],
    evidence: [
      { file: "server/modules/whatsapp/intentClarificationActions.issue858.test.ts", requiredTokens: ["originalText", "cancel"] },
      { file: "server/whatsappIntentWebhook.test.ts", requiredTokens: ["clarification", "interactive"] },
    ],
  },
  "food_clarification.quantity": {
    modalities: ["text", "audio_transcription", "simulator", "image_context"],
    evidence: [
      { file: "server/modules/whatsapp/foodClarification.test.ts", requiredTokens: ["quantity", "originalText"] },
      { file: "server/modules/whatsapp/foodClarification.test.ts", requiredTokens: ["natual", "natural"] },
    ],
  },
  "food_clarification.confirmation": {
    modalities: ["text", "callback", "audio_transcription", "simulator", "image_context"],
    evidence: [
      { file: "server/modules/whatsapp/foodClarification.test.ts", requiredTokens: ["confirmation", "cancel"] },
    ],
  },
  "food_clarification.selection": {
    modalities: ["text", "callback", "audio_transcription", "simulator", "image_context"],
    evidence: [
      { file: "server/modules/whatsapp/foodClarificationPlan.test.ts", requiredTokens: ["selection", "candidates"] },
    ],
  },
};

export const ISSUE_857_REGRESSION_MATRIX: readonly Issue857RegressionEvidence[] = WHATSAPP_INTERACTION_REGISTRY.map(interaction => {
  const scenario = INTERACTION_SCENARIOS[interaction.id];
  if (!scenario) {
    throw new Error(`Missing executable regression scenario for WhatsApp interaction ${interaction.id}`);
  }

  return {
    interactionId: interaction.id,
    pendingType: interaction.pendingType,
    classification: interaction.classification,
    entrypoints: interaction.entrypoints,
    applicableModalities: scenario.modalities,
    requiredBehaviors: interaction.classification === "closed"
      ? [
          "canonical_actions",
          "interactive_component",
          "invalid_response_representation",
          "stale_without_recreation",
          "callback_idempotency",
          "cross_user_isolation",
          "transport_fallback_success",
          "transport_total_failure_without_delivery",
        ]
      : [
          "preserve_original_context",
          "request_only_missing_data",
          "stale_without_recreation",
          "command_word_not_persisted",
        ],
    scenarioEvidence: [...scenario.evidence, ...COMMON_TRANSPORT_EVIDENCE],
  };
});
