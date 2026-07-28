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
 * smaller OpenAPI-style `Schema` type. Unsupported constructs, input parts,
 * message roles and tools are rejected locally before any network call.
 */
function incompatibleOperation(message: string): AiNonRetryableError {
  return new AiNonRetryableError(message, undefined, "incompatible_operation");
}

function invalidPayload(message: string): AiOperationalError {
  return new AiOperationalError(message, undefined, "invalid_payload");
}

const SUPPORTED_INLINE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function buildInlineImagePart(imageUrl: string, path: string): Part {
  const commaIndex = imageUrl.indexOf(",");
  if (commaIndex < 0) {
    throw invalidPayload(`GeminiProvider: ${path} contains a malformed data URL.`);
  }

  const header = imageUrl.slice(0, commaIndex);
  const data = imageUrl.slice(commaIndex + 1);
  const headerMatch = /^data:([^;,]+);base64$/i.exec(header);
  if (!headerMatch || !data.trim()) {
    throw invalidPayload(
      `GeminiProvider: ${path} must contain a non-empty base64 data URL with an explicit MIME type.`,
    );
  }

  const mimeType = headerMatch[1].toLowerCase();
  if (!SUPPORTED_INLINE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw incompatibleOperation(
      `GeminiProvider: ${path} uses unsupported image MIME type ${mimeType}.`,
    );
  }

  return { inlineData: { mimeType, data } };
}

function buildGeminiMessageParts(content: unknown, messagePath: string): Part[] {
  const items = Array.isArray(content) ? content : [content];
  if (items.length === 0) {
    throw invalidPayload(`GeminiProvider: ${messagePath}.content must not be empty.`);
  }

  const parts: Part[] = [];
  for (const [itemIndex, item] of items.entries()) {
    const itemPath = `${messagePath}.content[${itemIndex}]`;
    if (typeof item === "string") {
      if (!item.trim()) {
        throw invalidPayload(`GeminiProvider: ${itemPath} must not be empty.`);
      }
      parts.push({ text: item });
      continue;
    }

    if (typeof item !== "object" || item === null) {
      throw invalidPayload(`GeminiProvider: ${itemPath} is not a valid content part.`);
    }

    const part = item as Record<string, unknown>;
    if (part.type === "input_text") {
      if (typeof part.text !== "string" || !part.text.trim()) {
        throw invalidPayload(`GeminiProvider: ${itemPath}.text must be a non-empty string.`);
      }
      parts.push({ text: part.text });
      continue;
    }

    if (part.type === "input_image") {
      if (typeof part.image_url !== "string" || !part.image_url.trim()) {
        throw invalidPayload(`GeminiProvider: ${itemPath}.image_url must be a non-empty string.`);
      }

      const imageUrl = part.image_url;
      if (!imageUrl.startsWith("data:")) {
        throw incompatibleOperation(
          `GeminiProvider: ${itemPath}.image_url must use an inline base64 data URL; external image URIs are not supported by the current models.generateContent adapter.`,
        );
      }
      parts.push(buildInlineImagePart(imageUrl, `${itemPath}.image_url`));
      continue;
    }

    throw incompatibleOperation(
      `GeminiProvider: ${itemPath} uses unsupported content part type ${String(part.type)}.`,
    );
  }

  return parts;
}

function translateGeminiRole(role: unknown, messagePath: string): "user" | "model" {
  if (role === "user") return "user";
  if (role === "assistant") return "model";
  throw incompatibleOperation(
    `GeminiProvider: ${messagePath}.role ${String(role)} is not representable by the current adapter.`,
  );
}

function buildGeminiContents(contentItems: AiProviderTextRequest["input"]): ContentListUnion {
  if (typeof contentItems === "string") {
    if (!contentItems.trim()) {
      throw invalidPayload("GeminiProvider: direct text input must not be empty.");
    }
    return [{ role: "user", parts: [{ text: contentItems }] }];
  }

  if (!Array.isArray(contentItems) || contentItems.length === 0) {
    throw invalidPayload("GeminiProvider: request input must contain at least one message.");
  }

  return contentItems.map((message, messageIndex): Content => {
    const messagePath = `input[${messageIndex}]`;
    if (typeof message !== "object" || message === null || !("content" in message)) {
      throw invalidPayload(`GeminiProvider: ${messagePath} must declare content.`);
    }

    const messageRecord = message as unknown as Record<string, unknown>;
    if (!("role" in messageRecord)) {
      throw invalidPayload(`GeminiProvider: ${messagePath} must declare role.`);
    }

    return {
      role: translateGeminiRole(messageRecord.role, messagePath),
      parts: buildGeminiMessageParts(messageRecord.content, messagePath),
    };
  });
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

type JsonSchemaRecord = Record<string, unknown>;

function schemaError(path: string, message: string): never {
  throw incompatibleOperation(`GeminiProvider: JSON Schema at ${path} ${message}`);
}

function asSchemaRecord(value: unknown, path: string): JsonSchemaRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    schemaError(path, "must be an object.");
  }
  return value as JsonSchemaRecord;
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

function assertSchemaMapShape(value: unknown, path: string, keyword: string): void {
  const map = asSchemaRecord(value, path);
  for (const [name, schema] of Object.entries(map)) {
    assertSchemaShape(schema, `${path}.${keyword}.${name}`);
  }
}

function assertSchemaArrayShape(value: unknown, path: string, keyword: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    schemaError(path, `requires a non-empty schema array for "${keyword}".`);
  }
  value.forEach((schema, index) => assertSchemaShape(schema, `${path}.${keyword}[${index}]`));
}

function assertSchemaShape(value: unknown, path = "$"): void {
  const schema = asSchemaRecord(value, path);
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
  if ("propertyOrdering" in schema) assertStringArray(schema.propertyOrdering, path, "propertyOrdering");

  if ("$defs" in schema) assertSchemaMapShape(schema.$defs, path, "$defs");
  if ("properties" in schema) assertSchemaMapShape(schema.properties, path, "properties");
  if ("items" in schema) assertSchemaShape(schema.items, `${path}.items`);
  if ("prefixItems" in schema) assertSchemaArrayShape(schema.prefixItems, path, "prefixItems");
  if ("anyOf" in schema) assertSchemaArrayShape(schema.anyOf, path, "anyOf");

  if ("additionalProperties" in schema && typeof schema.additionalProperties !== "boolean") {
    assertSchemaShape(schema.additionalProperties, `${path}.additionalProperties`);
  }
}

function decodePointerSegment(segment: string, path: string): string {
  try {
    return decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~");
  } catch {
    schemaError(path, "contains an invalid URI-encoded JSON Pointer segment.");
  }
}

function resolveLocalSchemaRef(root: JsonSchemaRecord, ref: string, path: string): JsonSchemaRecord {
  if (ref === "#") return root;
  if (!ref.startsWith("#/")) {
    schemaError(path, `uses external or unsupported reference "${ref}".`);
  }

  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = decodePointerSegment(rawSegment, path);
    if (typeof current !== "object" || current === null || Array.isArray(current) || !(segment in current)) {
      schemaError(path, `references missing target "${ref}".`);
    }
    current = (current as JsonSchemaRecord)[segment];
  }

  return asSchemaRecord(current, `${path} -> ${ref}`);
}

function visitChildSchemas(
  schema: JsonSchemaRecord,
  path: string,
  visitor: (child: JsonSchemaRecord, childPath: string, optionalEdge: boolean) => void,
): void {
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === "string")
      : [],
  );

  if (typeof schema.properties === "object" && schema.properties !== null && !Array.isArray(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties as JsonSchemaRecord)) {
      visitor(asSchemaRecord(child, `${path}.properties.${name}`), `${path}.properties.${name}`, !required.has(name));
    }
  }
  if (schema.items !== undefined) {
    visitor(asSchemaRecord(schema.items, `${path}.items`), `${path}.items`, false);
  }
  if (Array.isArray(schema.prefixItems)) {
    schema.prefixItems.forEach((child, index) =>
      visitor(asSchemaRecord(child, `${path}.prefixItems[${index}]`), `${path}.prefixItems[${index}]`, false));
  }
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf.forEach((child, index) =>
      visitor(asSchemaRecord(child, `${path}.anyOf[${index}]`), `${path}.anyOf[${index}]`, false));
  }
  if (typeof schema.additionalProperties === "object" && schema.additionalProperties !== null) {
    visitor(
      asSchemaRecord(schema.additionalProperties, `${path}.additionalProperties`),
      `${path}.additionalProperties`,
      false,
    );
  }
}

function assertAllReferencesResolve(schema: JsonSchemaRecord, root: JsonSchemaRecord, path = "$"): void {
  const normalizedPath = path.trim();
  if (typeof schema.$ref === "string") {
    resolveLocalSchemaRef(root, schema.$ref, normalizedPath);
  }

  if (typeof schema.$defs === "object" && schema.$defs !== null && !Array.isArray(schema.$defs)) {
    for (const [name, child] of Object.entries(schema.$defs as JsonSchemaRecord)) {
      assertAllReferencesResolve(asSchemaRecord(child, `${normalizedPath}.$defs.${name}`), root, `${normalizedPath}.$defs.${name}`);
    }
  }
  visitChildSchemas(schema, normalizedPath, (child, childPath) =>
    assertAllReferencesResolve(child, root, childPath));
}

function assertSupportedReferenceCycles(root: JsonSchemaRecord): void {
  const visit = (
    schema: JsonSchemaRecord,
    path: string,
    activeOptionalEdgeCounts: Map<JsonSchemaRecord, number>,
    optionalEdgeCount: number,
  ): void => {
    const activeOptionalEdgeCount = activeOptionalEdgeCounts.get(schema);
    if (activeOptionalEdgeCount !== undefined) {
      if (optionalEdgeCount === activeOptionalEdgeCount) {
        schemaError(path, "contains a reference cycle reachable only through required schema edges.");
      }
      return;
    }

    activeOptionalEdgeCounts.set(schema, optionalEdgeCount);
    if (typeof schema.$ref === "string") {
      const target = resolveLocalSchemaRef(root, schema.$ref, path);
      const targetOptionalEdgeCount = activeOptionalEdgeCounts.get(target);
      if (targetOptionalEdgeCount !== undefined) {
        if (optionalEdgeCount === targetOptionalEdgeCount) {
          schemaError(path, `contains required recursive reference "${schema.$ref}".`);
        }
      } else {
        visit(target, `${path} -> ${schema.$ref}`, activeOptionalEdgeCounts, optionalEdgeCount);
      }
      activeOptionalEdgeCounts.delete(schema);
      return;
    }

    visitChildSchemas(schema, path, (child, childPath, optionalEdge) =>
      visit(
        child,
        childPath,
        activeOptionalEdgeCounts,
        optionalEdgeCount + (optionalEdge ? 1 : 0),
      ));
    activeOptionalEdgeCounts.delete(schema);
  };

  visit(root, "$", new Map(), 0);
}

/**
 * `responseJsonSchema` accepts only an explicit subset of JSON Schema. Validate
 * that subset rather than maintaining a denylist so a newly observed keyword
 * fails closed before content is sent to Gemini. References must be local and
 * resolvable; recursive references are accepted only when the cycle crosses an
 * optional property, matching the representability constraint of the SDK.
 */
function assertRepresentableSchema(value: unknown): void {
  assertSchemaShape(value);
  const root = asSchemaRecord(value, "$");
  assertAllReferencesResolve(root, root);
  assertSupportedReferenceCycles(root);
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
    const contents = buildGeminiContents(request.input);
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
