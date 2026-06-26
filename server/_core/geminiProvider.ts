import {
  GoogleGenerativeAI,
  type Content,
  type GenerationConfig,
  type Part,
  type Schema,
  SchemaType,
} from "@google/generative-ai";
import type {
  AiProvider,
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderImageGenerationRequest,
  AiProviderImageGenerationResponse,
  AiProviderTextRequest,
  AiProviderTextResponse,
} from "./aiProvider";

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
 * Convert an AiProviderResponseFormat json_schema into a Gemini Schema object.
 * Gemini uses its own Schema type (not JSON Schema draft-07), so we do a
 * best-effort conversion of the most common constructs used in this project.
 */
function convertJsonSchemaToGeminiSchema(schema: Record<string, unknown>): Schema {
  const type = schema.type as string | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = schema.required as string[] | undefined;
  const items = schema.items as Record<string, unknown> | undefined;
  const enumValues = schema.enum as string[] | undefined;
  const minimum = schema.minimum as number | undefined;
  const maximum = schema.maximum as number | undefined;

  if (enumValues) {
    return {
      type: SchemaType.STRING,
      enum: enumValues,
      format: "enum",
    } as Schema;
  }

  if (type === "object" && properties) {
    const geminiProperties: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(properties)) {
      geminiProperties[key] = convertJsonSchemaToGeminiSchema(value);
    }
    return {
      type: SchemaType.OBJECT,
      properties: geminiProperties,
      required,
    };
  }

  if (type === "array" && items) {
    return {
      type: SchemaType.ARRAY,
      items: convertJsonSchemaToGeminiSchema(items),
    };
  }

  if (type === "string") {
    return { type: SchemaType.STRING };
  }

  if (type === "number") {
    // Gemini's NumberSchema does not expose min/max in the TypeScript types;
    // we cast to Schema to avoid the type error while preserving the intent.
    return { type: SchemaType.NUMBER } as Schema;
  }

  if (type === "boolean") {
    return { type: SchemaType.BOOLEAN };
  }

  if (type === "integer") {
    return { type: SchemaType.INTEGER };
  }

  // Fallback: treat as string
  return { type: SchemaType.STRING };
}

function buildGenerationConfig(
  request: AiProviderTextRequest,
): GenerationConfig {
  const config: GenerationConfig = {
    maxOutputTokens: 8192,
  };

  if (request.format && request.format.type === "json_schema") {
    config.responseMimeType = "application/json";
    config.responseSchema = convertJsonSchemaToGeminiSchema(request.format.schema);
  }

  return config;
}

// ---------------------------------------------------------------------------
// GeminiProvider
// ---------------------------------------------------------------------------

export class GeminiProvider implements AiProvider {
  private readonly client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async createTextResponse(
    request: AiProviderTextRequest,
  ): Promise<AiProviderTextResponse> {
    const generationConfig = buildGenerationConfig(request);
    const systemInstruction = buildSystemInstruction(request.instructions);

    const model = this.client.getGenerativeModel({
      model: request.model,
      generationConfig,
      ...(systemInstruction ? { systemInstruction } : {}),
    });

    const parts = buildGeminiParts(request.input);

    if (!parts.length) {
      throw new Error("GeminiProvider: no content parts could be extracted from the request input.");
    }

    const result = await model.generateContent({ contents: [{ role: "user", parts }] });
    const response = result.response;
    const outputText = response.text();

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
