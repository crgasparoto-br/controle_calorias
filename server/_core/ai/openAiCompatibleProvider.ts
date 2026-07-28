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
import { AiNonRetryableError } from "./policyExecutor";

function containsInputImage(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsInputImage);
  if (typeof value !== "object" || value === null) return false;

  const record = value as Record<string, unknown>;
  if (record.type === "input_image") return true;
  return Object.values(record).some(containsInputImage);
}

function requiredTextOperations(request: AiProviderTextRequest): AiOperation[] {
  const required = new Set<AiOperation>(["text"]);
  if (containsInputImage(request.input)) required.add("vision");
  if (request.format?.type === "json_schema") required.add("structured_output");
  if (request.tools?.length) required.add("web_search");
  return [...required];
}

/**
 * Adapter guard for OpenAI-compatible endpoints.
 *
 * The underlying SDK surface is intentionally broader than the endpoint's
 * validated contract. Every operation is checked again at the adapter boundary
 * so a consumer cannot bypass the capability resolver and send unsupported
 * payloads to the compatible endpoint.
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
    this.assertAllowed([
      request.originalImages?.some(image => Boolean(image.b64Json))
        ? "image_edit"
        : "image_generation",
    ]);
    return this.delegate.createImageGeneration(request, options);
  }
}
