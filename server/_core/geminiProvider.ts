import {
  GoogleGenAI,
  type Content,
  type ContentListUnion,
  type GenerateContentConfig,
  type Part,
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
 * Gemini adapter built on `@google/genai` using `models.generateContent`.
 *
 * Structured output uses `responseJsonSchema` so the JSON Schema used by the
 * existing meal consumer is preserved instead of being lossy-converted to the
 * smaller OpenAPI-style `Schema` type. Unsupported constructs are rejected
 * locally before any network call.
 */

function buildGeminiParts(contentItems: AiProviderTextRequest["input"]): Part[] {
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

// Supported responseJsonSchema keywords are documented by @google/genai.
// These constructs are deliberately rejected because the selected
// generateContent surface cannot represent them reliably for this project.
const UNSUPPORTED_SCHEMA_KEYWORDS = new Set([
  "allOf",
  "not",
  "patternProperties",
  "dependencies",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "then",
  "else",
  "unevaluatedItems",
  "unevaluatedProperties",
  "contains",
  "const",
]);

function assertRepresentableSchema(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertRepresentableSchema(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYWORDS.has(key)) {
      throw new Error(
        `GeminiProvider: JSON Schema keyword "${key}" at ${path} is not representable by the selected Gemini structured-output contract.`,
      );
    }
    assertRepresentableSchema(child, `${path}.${key}`);
  }
}

function buildGenerationConfig(request: AiProviderTextRequest): GenerateContentConfig {
  const config: GenerateContentConfig = { maxOutputTokens: 8192 };

  if (request.format?.type === "json_schema") {
    assertRepresentableSchema(request.format.schema);
    config.responseMimeType = "application/json";
    // responseJsonSchema preserves nullable types, additionalProperties=false,
    // numeric limits and array constraints used by the project's real schemas.
    (config as GenerateContentConfig & { responseJsonSchema?: unknown }).responseJsonSchema =
      request.format.schema;
  }

  const systemInstruction = buildSystemInstruction(request.instructions);
  if (systemInstruction) config.systemInstruction = systemInstruction;
  return config;
}

export class GeminiProvider implements AiProvider {
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async createTextResponse(request: AiProviderTextRequest): Promise<AiProviderTextResponse> {
    const parts = buildGeminiParts(request.input);
    if (!parts.length) {
      throw new Error("GeminiProvider: no content parts could be extracted from the request input.");
    }

    const contents: ContentListUnion = [{ role: "user", parts }];
    const response = await this.client.models.generateContent({
      model: request.model,
      contents,
      config: buildGenerationConfig(request),
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

  async createAudioTranscription(
    _request: AiProviderAudioTranscriptionRequest,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    throw new Error(
      "GeminiProvider does not support audio transcription. Configure an adapter that explicitly supports transcription.",
    );
  }

  async createImageGeneration(
    _request: AiProviderImageGenerationRequest,
  ): Promise<AiProviderImageGenerationResponse> {
    throw new Error(
      "GeminiProvider does not support image generation or editing in this project.",
    );
  }
}
