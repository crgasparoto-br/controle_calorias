import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderEmbeddingRequest,
  AiProviderEmbeddingResponse,
  AiProviderImageGenerationRequest,
  AiProviderImageGenerationResponse,
  AiProviderRequestOptions,
  AiProviderTextRequest,
  AiProviderTextResponse,
} from "../aiProvider";
import type { AiOperation } from "./capabilities";
import { AiNonRetryableError, AiOperationalError } from "./policyExecutor";

function invalidPayload(message: string): AiOperationalError {
  return new AiOperationalError(message, undefined, "invalid_payload");
}

function inspectContentPart(
  value: unknown,
  path: string,
  required: Set<AiOperation>,
): void {
  if (typeof value === "string") {
    if (!value.trim()) throw invalidPayload(`${path} must not be empty.`);
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidPayload(`${path} is not a valid compatible endpoint content part.`);
  }

  const part = value as Record<string, unknown>;
  if (part.type === "input_text") {
    if (typeof part.text !== "string" || !part.text.trim()) {
      throw invalidPayload(`${path}.text must be a non-empty string.`);
    }
    return;
  }
  if (part.type === "input_image") {
    if (typeof part.image_url !== "string" || !part.image_url.trim()) {
      throw invalidPayload(`${path}.image_url must be a non-empty string.`);
    }
    required.add("vision");
    return;
  }

  throw new AiNonRetryableError(
    `OpenAI-compatible endpoint cannot represent content part type ${String(part.type)}.`,
    undefined,
    "incompatible_operation",
  );
}

function inspectTextInput(value: unknown, required: Set<AiOperation>): void {
  if (typeof value === "string") {
    if (!value.trim()) throw invalidPayload("OpenAI-compatible text input must not be empty.");
    return;
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidPayload("OpenAI-compatible text input must contain at least one message.");
  }

  value.forEach((item, itemIndex) => {
    const path = `input[${itemIndex}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw invalidPayload(`${path} is not a valid message.`);
    }

    const message = item as Record<string, unknown>;
    if (message.type !== undefined && message.type !== "message") {
      throw new AiNonRetryableError(
        `OpenAI-compatible endpoint cannot represent input item type ${String(message.type)}.`,
        undefined,
        "incompatible_operation",
      );
    }
    if (!("content" in message)) {
      throw invalidPayload(`${path} must declare content.`);
    }

    const content = message.content;
    const parts = Array.isArray(content) ? content : [content];
    if (parts.length === 0) throw invalidPayload(`${path}.content must not be empty.`);
    parts.forEach((part, partIndex) =>
      inspectContentPart(part, `${path}.content[${partIndex}]`, required));
  });
}

function requiredTextOperations(request: AiProviderTextRequest): AiOperation[] {
  const required = new Set<AiOperation>(["text"]);
  inspectTextInput(request.input, required);
  if (request.format?.type === "json_schema") required.add("structured_output");
  if (request.tools?.length) required.add("web_search");
  return [...required];
}

/**
 * Adapter guard for OpenAI-compatible endpoints.
 *
 * The underlying SDK surface is intentionally broader than the endpoint's
 * validated contract. Every operation and input family is checked again at the
 * adapter boundary so a consumer cannot bypass the capability resolver and send
 * unsupported payloads to the compatible endpoint.
 */
export class OpenAiCompatibleProvider implements AiProvider {
  private readonly allowedOperations: ReadonlySet<AiOperation>;

  constructor(
    private readonly delegate: AiProvider,
    allowedOperations: readonly AiOperation[],
  ) {
    this.allowedOperations = new Set(allowedOperations);
  }

  private assertAllowed(operations: readonly AiOperation[]): void {
    const denied = operations.filter(operation => !this.allowedOperations.has(operation));
    if (denied.length === 0) return;

    throw new AiNonRetryableError(
      `OpenAI-compatible endpoint does not allow operation(s): ${denied.join(", ")}.`,
      undefined,
      "incompatible_operation",
    );
  }

  async createTextResponse(
    request: AiProviderTextRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderTextResponse> {
    this.assertAllowed(requiredTextOperations(request));
    return this.delegate.createTextResponse(request, options);
  }

  async createEmbeddings(
    request: AiProviderEmbeddingRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderEmbeddingResponse> {
    this.assertAllowed(["embeddings"]);
    return this.delegate.createEmbeddings(request, options);
  }

  async createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    this.assertAllowed(["transcription"]);
    return this.delegate.createAudioTranscription(request, options);
  }

  async createImageGeneration(
    request: AiProviderImageGenerationRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderImageGenerationResponse> {
    const isEdit = Boolean(request.originalImages?.length);
    this.assertAllowed([isEdit ? "image_edit" : "image_generation"]);
    if (isEdit && request.originalImages?.some(image => !image.b64Json.trim())) {
      throw invalidPayload("OpenAI-compatible image edit requires non-empty original images.");
    }
    return this.delegate.createImageGeneration(request, options);
  }
}
