import { WHATSAPP_INTERACTION_REGISTRY } from "./interactionRegistry";

export type Issue857RegressionModality = "text" | "callback" | "audio_transcription" | "simulator" | "image_context";

export type Issue857RegressionEvidence = {
  interactionId: string;
  pendingType: string;
  classification: "open" | "closed";
  entrypoints: readonly string[];
  modalities: readonly Issue857RegressionModality[];
  requiredBehaviors: readonly string[];
  evidenceFiles: readonly string[];
};

const SHARED_ENTRYPOINT_EVIDENCE = [
  "server/whatsappWebhook.test.ts",
  "server/whatsappIntentWebhook.test.ts",
  "server/whatsappWebhook.audioTranscription.test.ts",
] as const;

const SHARED_TRANSPORT_EVIDENCE = [
  "server/modules/whatsapp/logicalReplyDelivery.test.ts",
  "server/modules/whatsapp/replyTransport.test.ts",
] as const;

const INTERACTION_SPECIFIC_EVIDENCE: Record<string, readonly string[]> = {
  "delete.confirmation": [
    "server/modules/whatsapp/deleteIntent.canonicalProgress.test.ts",
    "server/modules/whatsapp/deleteIntent.test.ts",
  ],
  "delete.candidate_selection": [
    "server/modules/whatsapp/deleteIntent.canonicalProgress.test.ts",
    "server/modules/whatsapp/deleteIntent.test.ts",
  ],
  "meal_item.candidate_selection": [
    "server/modules/whatsapp/mealItemSelectionCallback.test.ts",
    "server/modules/whatsapp/intentActions.quantityCorrection.test.ts",
  ],
  "generic_confirmation.confirm_cancel": [
    "server/modules/whatsapp/webhookTextCommands.test.ts",
  ],
  "generic_confirmation.reclassify_scope": [
    "server/modules/whatsapp/webhookTextCommands.test.ts",
  ],
  "period_report.period_selection": [
    "server/modules/whatsapp/periodReportClarification.test.ts",
  ],
  "professional_access.authorization": [
    "server/modules/professionals/service.test.ts",
  ],
  "intent_clarification.generic": [
    "server/modules/whatsapp/intentClarificationInteraction.test.ts",
  ],
  "food_clarification.quantity": [
    "server/modules/whatsapp/foodClarification.test.ts",
  ],
  "food_clarification.confirmation": [
    "server/modules/whatsapp/foodClarification.test.ts",
  ],
  "food_clarification.selection": [
    "server/modules/whatsapp/foodClarification.test.ts",
  ],
};

export const ISSUE_857_REGRESSION_MATRIX: readonly Issue857RegressionEvidence[] = WHATSAPP_INTERACTION_REGISTRY.map(interaction => ({
  interactionId: interaction.id,
  pendingType: interaction.pendingType,
  classification: interaction.classification,
  entrypoints: interaction.entrypoints,
  modalities: ["text", "callback", "audio_transcription", "simulator", "image_context"],
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
  evidenceFiles: [
    ...SHARED_ENTRYPOINT_EVIDENCE,
    ...SHARED_TRANSPORT_EVIDENCE,
    ...(INTERACTION_SPECIFIC_EVIDENCE[interaction.id] ?? []),
  ],
}));
