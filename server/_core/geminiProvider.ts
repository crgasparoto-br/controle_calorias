import {
  GoogleGenAI,
  type Content,
  type ContentListUnion,
  type GenerateContentConfig,
  type Part,
} from "@google/genai";
import { AiNonRetryableError, AiOperationalError } from "./ai/policyExecutor";
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
} from "./aiProvider";

/**
 * Gemini adapter built on `@google/genai` using `models.generateContent`.
 *
 * Structured output uses `responseJsonSchema` so the JSON Schema used by the
 * existing meal consumer is preserved instead of being lossy-converted to the
 * smaller OpenAPI-style `Schema` type. Unsupported constructs and tools are
 * rejected locally before any network call.
 */

function buildGeminiParts(contentItems: AiProviderTextRequest["input"]): Part[] {
  if (typeof contentItems === "string") {
    return contentItems.trim() ? [{ text: contentItems }] : [];
  }

  const parts: Part[] = [];
  const inputArray = contentItems as unknown[];
  if (!Array.isArray(inputArray)) return parts;

  for (const message of inputArray) {
    if (typeof message !== "object" || message === null || !("content" in message)) continue;
    const content = (message as Record<string, unknown>).content;
    const items = Array.isArray(content) ? content : [content];

    for (const item of items) {
      if (typeof item === "string") {
        parts.push({ text: item });
        continue;
      }
      if (typeof item !== "object" || item === null) continue;

      const part = item as Record<string, unknown>;
      if (part.type === "input_text" && typeof part.text === "string") {
        parts.push({ text: part.text });
        continue;
      }

      if (part.type === "input_image" && typeof part.image_url === "string") {
        const imageUrl = part.image_url;
        if (imageUrl.startsWith("data:")) {
          const commaIndex = imageUrl.indexOf(",");
          if (commaIndex < 0) continue;
          const header = imageUrl.slice(0, commaIndex);
          const data = imageUrl.slice(commaIndex + 1);
          const mimeType = header.replace("data:", "").replace(";base64", "") || "image/jpeg";
          parts.push({ inlineData: { mimeType, data } });
        } else {
          parts.push({
            fileData: {
              mimeType: "image/jpeg",
              fileUri: imageUrl,
            },
          });
        }
      }
    }
  }

  return parts;
}

function buildSystemInstruction(instructions: string | undefined): Content | undefined {
  if (!instructions) return undefined;
  return { role: "user", parts: [{ text: instructions }] };
}

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  "$id",
  "$defs",
  "$ref",
  "$anchor",
  "type",
  "format",
  "title",
  "description",
  "enum",
  "items",
  "prefixItems",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "anyOf",
  "properties",
  "additionalProperties",
  "required",
  "propertyOrdering",
]);

const SUPPORTED_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

function incompatibleOperation(message: string): AiNonRetryableError {
  return new AiNonRetryableError(message, undefined, "incompatible_operation");
}

function schemaError(path: string, message: string): never {
  throw incompatibleOperation(`GeminiProvider: JSON Schema at ${path} ${message}`);
}

function assertString(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "string" || !value.trim()) {
    schemaError(path, `requires a non-empty string for "${keyword}".`);
  }
}

function assertStringArray(value: unknown, path: string, keyword: string): void {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
    schemaError(path, `requires an array of non-empty strings for "${keyword}".`);
  }
}

function assertNonNegativeInteger(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    schemaError(path, `requires a non-negative integer for "${keyword}".`);
  }
}

function assertFiniteNumber(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    schemaError(path, `requires a finite number for "${keyword}".`);
  }
}

function assertSchemaType(value: unknown, path: string): void {
  const values = Array.isArray(value) ? value : [value];
  if (
    values.length === 0 ||
    values.some(item => typeof item !== "string" || !SUPPORTED_SCHEMA_TYPES.has(item)) ||
    new Set(values).size !== values.length
  ) {
    schemaError(path, "declares an unsupported or duplicated type.");
  }
}

function assertSchemaMap(value: unknown, path: string, keyword: string): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    schemaError(path, `requires an object for "${keyword}".`);
  }
  for (const [name, schema] of Object.entries(value as Record<string, unknown>)) {
    assertRepresentableSchema(schema, `${path}.${keyword}.${name}`);
  }
}

function assertSchemaArray(value: unknown, path: string, keyword: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    schemaError(path, `requires a non-empty schema array for "${keyword}".`);
  }
  value.forEach((schema, index) => assertRepresentableSchema(schema, `${path}.${keyword}[${index}]`));
}

/**
 * `responseJsonSchema` accepts only an explicit subset of JSON Schema. Validate
 * that subset rather than maintaining a denylist so a newly observed keyword
 * fails closed before content is sent to Gemini. `oneOf` is deliberately
 * rejected because Gemini interprets it as `anyOf`, which would weaken the
 * caller's contract.
 */
function assertRepresentableSchema(value: unknown, path = "$"): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    schemaError(path, "must be an object.");
  }

  const schema = value as Record<string, unknown>;
  if ("oneOf" in schema) {
    schemaError(path, 'uses "oneOf", which Gemini interprets as "anyOf" and would change validation semantics.');
  }

  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      schemaError(path, `uses unsupported keyword "${key}".`);
    }
  }

  if ("$ref" in schema) {
    assertString(schema.$ref, path, "$ref");
    const incompatibleSibling = Object.keys(schema).find(key => !key.startsWith("$"));
    if (incompatibleSibling) {
      schemaError(path, `combines "$ref" with non-$ sibling "${incompatibleSibling}".`);
    }
  }

  if ("$id" in schema) assertString(schema.$id, path, "$id");
  if ("$anchor" in schema) assertString(schema.$anchor, path, "$anchor");
  if ("format" in schema) assertString(schema.format, path, "format");
  if ("title" in schema && typeof schema.title !== "string") schemaError(path, 'requires a string for "title".');
  if ("description" in schema && typeof schema.description !== "string") {
    schemaError(path, 'requires a string for "description".');
  }
  if ("type" in schema) assertSchemaType(schema.type, path);

  if ("enum" in schema) {
    if (
      !Array.isArray(schema.enum) ||
      schema.enum.length === 0 ||
      schema.enum.some(item =>
        (typeof item !== "string" && typeof item !== "number") ||
        (typeof item === "number" && !Number.isFinite(item)))
    ) {
      schemaError(path, 'requires a non-empty string/number array for "enum".');
    }
  }

  if ("minItems" in schema) assertNonNegativeInteger(schema.minItems, path, "minItems");
  if ("maxItems" in schema) assertNonNegativeInteger(schema.maxItems, path, "maxItems");
  if ("minimum" in schema) assertFiniteNumber(schema.minimum, path, "minimum");
  if ("maximum" in schema) assertFiniteNumber(schema.maximum, path, "maximum");
  if ("required" in schema) assertStringArray(schema.required, path, "required");
  if ("propertyOrdering" in schema) {
    assertStringArray(schema.propertyOrdering, path, "propertyOrdering");
  }

  if ("$defs" in schema) assertSchemaMap(schema.$defs, path, "$defs");
  if ("properties" in schema) assertSchemaMap(schema.properties, path, "properties");
  if ("items" in schema) assertRepresentableSchema(schema.items, `${path}.items`);
  if ("prefixItems" in schema) assertSchemaArray(schema.prefixItems, path, "prefixItems");
  if ("anyOf" in schema) assertSchemaArray(schema.anyOf, path, "anyOf");

  if ("additionalProperties" in schema) {
    const additionalProperties = schema.additionalProperties;
    if (typeof additionalProperties !== "boolean") {
      assertRepresentableSchema(additionalProperties, `${path}.additionalProperties`);
    }
  }
}

function assertRepresentableTools(request: AiProviderTextRequest): void {
  if (!request.tools?.length) return;
  throw incompatibleOperation(
    "GeminiProvider: request tools are not representable by the current adapter. Google Search translation must be implemented explicitly before network access.",
  );
}

function buildGenerationConfig(
  request: AiProviderTextRequest,
  options?: AiProviderRequestOptions,
): GenerateContentConfig {
  const config: GenerateContentConfig = { maxOutputTokens: 8192 };

  if (request.format?.type === "json_schema") {
    assertRepresentableSchema(request.format.schema);
    config.responseMimeType = "application/json";
    config.responseJsonSchema = request.format.schema;
  }

  const systemInstruction = buildSystemInstruction(request.instructions);
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (options?.signal) config.abortSignal = options.signal;
  return config;
}

export class GeminiProvider implements AiProvider {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async createTextResponse(
    request: AiProviderTextRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderTextResponse> {
    assertRepresentableTools(request);
    const parts = buildGeminiParts(request.input);
    if (!parts.length) {
      throw new AiOperationalError(
        "GeminiProvider: no content parts could be extracted from the request input.",
        undefined,
        "invalid_payload",
      );
    }

    const contents: ContentListUnion = [{ role: "user", parts }];
    const response = await this.client.models.generateContent({
      model: request.model,
      contents,
      config: buildGenerationConfig(request, options),
    });

    const usageMetadata = response.usageMetadata;
    return {
      id: `gemini-${Date.now()}`,
      outputText: response.text ?? "",
      raw: response,
      ...(usageMetadata
        ? {
            usage: {
              inputTokens: usageMetadata.promptTokenCount,
              outputTokens: usageMetadata.candidatesTokenCount,
              totalTokens: usageMetadata.totalTokenCount,
              raw: usageMetadata,
            },
          }
        : {}),
    } as AiProviderTextResponse;
  }

  async createEmbeddings(
    _request: AiProviderEmbeddingRequest,
    _options?: AiProviderRequestOptions,
  ): Promise<AiProviderEmbeddingResponse> {
    throw incompatibleOperation(
      "GeminiProvider does not support embeddings in this project. Configure an adapter that explicitly supports embeddings.",
    );
  }

  async createAudioTranscription(
    _request: AiProviderAudioTranscriptionRequest,
    _options?: AiProviderRequestOptions,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    throw incompatibleOperation(
      "GeminiProvider does not support audio transcription. Configure an adapter that explicitly supports transcription.",
    );
  }

  async createImageGeneration(
    _request: AiProviderImageGenerationRequest,
    _options?: AiProviderRequestOptions,
  ): Promise<AiProviderImageGenerationResponse> {
    throw incompatibleOperation(
      "GeminiProvider does not support image generation or editing in this project.",
    );
  }
}
