/**
 * Typed registry of AI capabilities used by the product.
 *
 * A capability is a product-facing AI use case. Each capability declares the
 * low-level adapter operations it requires. Provider/model resolution validates
 * these requirements before any network call is allowed.
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
  /** Short human-readable description for sanitized diagnostics. */
  description: string;
  /** Operations this capability requires from a compatible adapter. */
  requiredOperations: readonly AiOperation[];
  /** Whether this capability currently has a production consumer, migrated or legacy. */
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
    description: "Interpretação estruturada de intenção do WhatsApp",
    requiredOperations: ["text", "structured_output"],
    hasConsumer: true,
  },
  QUESTION: {
    id: "QUESTION",
    description: "Assistente de perguntas do usuário com pesquisa web",
    requiredOperations: ["text", "web_search"],
    hasConsumer: true,
  },
  NUTRITION_SEARCH: {
    id: "NUTRITION_SEARCH",
    description: "Pesquisa nutricional com ferramenta de busca web",
    requiredOperations: ["text", "structured_output", "web_search"],
    hasConsumer: true,
  },
  EMBEDDING: {
    id: "EMBEDDING",
    description: "Geração de embeddings para busca semântica",
    requiredOperations: ["embeddings"],
    hasConsumer: true,
  },
  TRANSCRIPTION: {
    id: "TRANSCRIPTION",
    description: "Transcrição de áudio recebido via WhatsApp",
    requiredOperations: ["transcription"],
    hasConsumer: true,
  },
  IMAGE_ANNOTATION: {
    id: "IMAGE_ANNOTATION",
    description: "Geração ou edição de imagem anotada da refeição",
    requiredOperations: ["image_generation", "image_edit"],
    hasConsumer: true,
  },
  FOOD_CLASSIFICATION: {
    id: "FOOD_CLASSIFICATION",
    description:
      "Reservado (#922): classificação NOVA embutida em MEAL_TEXT/MEAL_VISION, sem consumidor próprio nesta fase",
    requiredOperations: ["text", "structured_output"],
    hasConsumer: false,
  },
};

export function getCapabilityDefinition(id: AiCapabilityId): AiCapabilityDefinition {
  return AI_CAPABILITY_REGISTRY[id];
}
