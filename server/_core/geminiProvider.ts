import {
  GoogleGenAI,
  Type,
  type Content,
  type ContentListUnion,
  type GenerateContentConfig,
  type Part,
  type Schema,
} from "@google/genai";
import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderImageGenerationRequest,
  AiProviderImageGenerationResponse,
  AiProviderTextRequest,
  AiProviderTextResponse,
} from "./aiProvider";

/**
 * Gemini adapter, built on the current `@google/genai` SDK (migrated from the
 * legacy `@google/generative-ai` SDK in issue #921). This adapter uses the
 * `models.generateContent` surface of the SDK (see ARCHITECTURE.md for the
 * rationale) — the simpler request/response surface, sufficient for the
 * text/vision/structured-output usage this project needs today. The
 * `Interactions`/session-oriented surface was not adopted: this project's
 * calls are stateless, single-turn requests per capability invocation, so
 * `generateContent` maps directly without extra session bookkeeping.
 *
 * Behavior preserved from the legacy adapter: same request/response shape
 * translation, same best-effort JSON Schema → Gemini Schema conversion, same
 * "no image/audio generation, no transcription" limitations. What changed
 * with the SDK migration: usage metadata is now surfaced on the response,
 * multimodal input translation is unified for text and inline image parts,
 * and the schema converter now validates unsupported schema constructs
 * up front instead of silently degrading them (see
 * `assertRepresentableSchema` below), so incompatible requests fail fast
 * before hitting the network.
 */

// ---------------------------------------------------------------------------
// Helpers: convert AiProvider request format → Gemini SDK types
// ---------------------------------------------------------------------------

function buildGeminiParts(
  contentItems: AiProviderTextRequest["input"],
): Part[] {
  const parts: Part[] = [];

  const inputArray = contentItems as unknown[];
  if (!Array.isArray(inputArray)) {
    return parts;
  }

  for (const message of inputArray) {
    if (typeof message !== "object" || message === null || !("content" in message)) {
      continue;
    }

    const msgObj = message as Record<string, unknown>;
    const content = msgObj.content;
    const items = Array.isArray(content) ? content : [content];

    for (const item of items) {
      if (typeof item === "string") {
        parts.push({ text: item });
        continue;
      }

      if (typeof item !== "object" || item === null) {
        continue;
      }

      const part = item as Record<string, unknown>;

      if (part.type === "input_text" && typeof part.text === "string") {
        parts.push({ text: part.text });
        continue;
      }

      if (part.type === "input_image" && typeof part.image_url === "string") {
        const imageUrl = part.image_url as string;

        if (imageUrl.startsWith("data:")) {
          // data URL → inline base64
          const [header, b64] = imageUrl.split(",");
          const mimeType = header.replace("data:", "").replace(";base64", "") || "image/jpeg";
          parts.push({
            inlineData: {
              mimeType,
              data: b64,
            },
          });
        } else {
          // remote URL → fileData
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
  return {
    role: "user",
    parts: [{ text: instructions }],
  };
}

/**
 * Best-effort JSON Schema (draft-07-ish, as used by this project's
 * structured outputs) → Gemini `Schema` conversion. Gemini's schema dialect
 * is a strict subset of JSON Schema, so unsupported constructs are validated
 * up front (see `assertRepresentableSchema`) rather than silently dropped.
 */
function convertJsonSchemaToGeminiSchema(schema: Record<string, unknown>): Schema {
  const type = schema.type as string | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;
  const items = schema.items as Record<string, unknown> | undefined;
  const enumValues = schema.enum as string[] | undefined;

  if (enumValues) {
    return {
      type: Type.STRING,
      enum: enumValues,
      format: "enum",
    };
  }

  if (type === "object" && properties) {
    const geminiProperties: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(properties)) {
      geminiProperties[key] = convertJsonSchemaToGeminiSchema(value);
    }
    return {
      type: Type.OBJECT,
      properties: geminiProperties,
      required,
    };
  }

  if (type === "array" && items) {
    return {
      type: Type.ARRAY,
      items: convertJsonSchemaToGeminiSchema(items),
    };
  }

  if (type === "string") {
    return { type: Type.STRING };
  }

  if (type === "number") {
    return { type: Type.NUMBER };
  }

  if (type === "boolean") {
    return { type: Type.BOOLEAN };
  }

  if (type === "integer") {
    return { type: Type.INTEGER };
  }

  // Fallback: treat as string
  return { type: Type.STRING };
}

const UNSUPPORTED_SCHEMA_KEYWORDS = [
  "oneOf",
  "anyOf",
  "allOf",
  "not",
  "$ref",
  "additionalProperties",
  "patternProperties",
] as const;

/**
 * Validates that a JSON Schema does not use constructs Gemini's Schema
 * dialect cannot represent, so incompatible requests are rejected locally
 * before making a network call, instead of being silently degraded.
 */
function assertRepresentableSchema(schema: Record<string, unknown>, path = "$"): void {
  for (const keyword of UNSUPPORTED_SCHEMA_KEYWORDS) {
    if (keyword in schema) {
      throw new Error(
        `GeminiProvider: JSON Schema keyword "${keyword}" at ${path} is not representable by the Gemini structured output schema.`,
      );
    }
  }

  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  if (properties) {
    for (const [key, value] of Object.entries(properties)) {
      assertRepresentableSchema(value, `${path}.${key}`);
    }
  }

  const items = schema.items as Record<string, unknown> | undefined;
  if (items) {
    assertRepresentableSchema(items, `${path}[]`);
  }
}

function buildGenerationConfig(
  request: AiProviderTextRequest,
): GenerateContentConfig {
  const config: GenerateContentConfig = {
    maxOutputTokens: 8192,
  };

  if (request.format && request.format.type === "json_schema") {
    assertRepresentableSchema(request.format.schema);
    config.responseMimeType = "application/json";
    config.responseSchema = convertJsonSchemaToGeminiSchema(request.format.schema);
  }

  const systemInstruction = buildSystemInstruction(request.instructions);
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }

  return config;
}

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

export class GeminiProvider implements AiProvider {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async createTextResponse(
    request: AiProviderTextRequest,
  ): Promise<AiProviderTextResponse> {
    const generationConfig = buildGenerationConfig(request);
    const parts = buildGeminiParts(request.input);

    if (!parts.length) {
      throw new Error("GeminiProvider: no content parts could be extracted from the request input.");
    }

    const contents: ContentListUnion = [{ role: "user", parts }];

    const response = await this.client.models.generateContent({
      model: request.model,
      contents,
      config: generationConfig,
    });

    const outputText = response.text ?? "";

    return {
      id: `gemini-${Date.now()}`,
      outputText,
      raw: response,
    };
  }

  async createAudioTranscription(
    _request: AiProviderAudioTranscriptionRequest,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    // Gemini does not offer a dedicated speech-to-text API compatible with the
    // Whisper interface. Audio transcription remains on OpenAI Whisper.
    // This method should not be called when AI_PROVIDER=gemini — the caller
    // (voiceTranscription.ts) should fall back to the OpenAI provider for audio.
    throw new Error(
      "GeminiProvider does not support audio transcription. " +
      "Configure OPENAI_API_KEY to keep Whisper for audio while using Gemini for vision/text.",
    );
  }

  async createImageGeneration(
    _request: AiProviderImageGenerationRequest,
  ): Promise<AiProviderImageGenerationResponse> {
    // Annotated meal image generation uses gpt-image-1 and is handled separately
    // via imageGeneration.ts, which has its own OpenAI client. This method is
    // not called in the current architecture.
    throw new Error(
      "GeminiProvider does not support image generation in this project. " +
      "Annotated meal images continue to use the OpenAI image provider.",
    );
  }
}
