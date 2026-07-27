/**
 * Typed registry of AI capabilities used by the product.
 *
 * A "capability" is a product-facing AI use case (e.g. extracting a meal from
 * text, answering a WhatsApp question). Each capability declares which
 * low-level operations it needs from an underlying provider adapter
 * (text generation, vision input, structured output, ...). The config
 * resolver (`configResolver.ts`) and the adapter support matrix
 * (`supportMatrix.ts`) use this declaration to pick and validate providers
 * per capability, independently from one another.
 *
 * FOOD_CLASSIFICATION is reserved: per the decision in issue #922, food
 * classification (NOVA) stays embedded in the MEAL_TEXT / MEAL_VISION
 * structured output for now and has no dedicated consumer yet. It is listed
 * here so the registry is complete and future work does not need to touch
 * this module again to add it.
 */

export const AI_CAPABILITIES = [
  "MEAL_TEXT",
  "MEAL_VISION",
  "WHATSAPP_INTENT",
  "QUESTION",
  "NUTRITION_SEARCH",
  "EMBEDDING",
  "TRANSCRIPTION",
  "IMAGE_ANNOTATION",
  "FOOD_CLASSIFICATION",
] as const;

export type AiCapabilityId = (typeof AI_CAPABILITIES)[number];

/**
 * Low-level operations a provider adapter may support. Capabilities declare
 * which of these they require; adapters declare which they implement.
 */
export const AI_OPERATIONS = [
  "text",
  "vision",
  "structured_output",
  "web_search",
  "embeddings",
  "transcription",
  "image_generation",
  "image_edit",
] as const;

export type AiOperation = (typeof AI_OPERATIONS)[number];

export type AiCapabilityDefinition = {
  id: AiCapabilityId;
  /** Short human-readable description for diagnostics/logging (no PII). */
  description: string;
  /** Operations this capability requires from a compatible adapter. */
  requiredOperations: readonly AiOperation[];
  /** Whether this capability currently has a production consumer. */
  hasConsumer: boolean;
};

export const AI_CAPABILITY_REGISTRY: Record<AiCapabilityId, AiCapabilityDefinition> = {
  MEAL_TEXT: {
    id: "MEAL_TEXT",
    description: "Extração estruturada de refeição a partir de texto",
    requiredOperations: ["text", "structured_output"],
    hasConsumer: true,
  },
  MEAL_VISION: {
    id: "MEAL_VISION",
    description: "Extração estruturada de refeição a partir de imagem",
    requiredOperations: ["text", "vision", "structured_output"],
    hasConsumer: true,
  },
  WHATSAPP_INTENT: {
    id: "WHATSAPP_INTENT",
    description: "Interpretação de intenção de mensagens do WhatsApp",
    requiredOperations: ["text", "structured_output"],
    hasConsumer: true,
  },
  QUESTION: {
    id: "QUESTION",
    description: "Assistente de perguntas do usuário (WhatsApp)",
    requiredOperations: ["text"],
    hasConsumer: true,
  },
  NUTRITION_SEARCH: {
    id: "NUTRITION_SEARCH",
    description: "Busca semântica no catálogo de alimentos",
    requiredOperations: ["embeddings"],
    hasConsumer: true,
  },
  EMBEDDING: {
    id: "EMBEDDING",
    description: "Geração de embeddings de propósito geral",
    requiredOperations: ["embeddings"],
    hasConsumer: false,
  },
  TRANSCRIPTION: {
    id: "TRANSCRIPTION",
    description: "Transcrição de áudio recebido via WhatsApp",
    requiredOperations: ["transcription"],
    hasConsumer: true,
  },
  IMAGE_ANNOTATION: {
    id: "IMAGE_ANNOTATION",
    description: "Geração de imagem anotada da refeição confirmada",
    requiredOperations: ["image_generation", "image_edit"],
    hasConsumer: true,
  },
  FOOD_CLASSIFICATION: {
    id: "FOOD_CLASSIFICATION",
    description:
      "Reservado (#922): classificação NOVA hoje embutida no structured output de MEAL_TEXT/MEAL_VISION, sem consumidor próprio nesta fase",
    requiredOperations: ["text", "structured_output"],
    hasConsumer: false,
  },
};

export function getCapabilityDefinition(id: AiCapabilityId): AiCapabilityDefinition {
  return AI_CAPABILITY_REGISTRY[id];
}
