import type OpenAI from "openai";
import type {
  Response as OpenAiResponse,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import { createOpenAiClient } from "./openaiClient";

export type AiProviderResponseFormat =
  | { type: "text" }
  | {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };

export type AiProviderTextTool = Record<string, unknown>;

export type AiProviderTextRequest = {
  model: string;
  instructions?: string;
  input: ResponseCreateParamsNonStreaming["input"];
  format?: AiProviderResponseFormat;
  tools?: AiProviderTextTool[];
};

export type AiProviderTextResponse = {
  id: string;
  outputText: string;
  raw: unknown;
};

export type AiProviderAudioTranscriptionRequest = {
  file: File;
  model: string;
  language?: string;
  prompt?: string;
};

export type AiProviderAudioTranscriptionSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

export type AiProviderAudioTranscriptionResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: AiProviderAudioTranscriptionSegment[];
  raw: unknown;
};

export type AiProviderImageInput = {
  b64Json: string;
  mimeType?: string;
};

export type AiProviderImageGenerationRequest = {
  prompt: string;
  model: string;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "low" | "medium" | "high";
  outputFormat?: "png" | "webp" | "jpeg";
  originalImages?: AiProviderImageInput[];
};

export type AiProviderImageGenerationResponse = {
  b64Json: string;
  mimeType: string;
  raw: unknown;
};

export interface AiProvider {
  createTextResponse(
    request: AiProviderTextRequest,
  ): Promise<AiProviderTextResponse>;
  createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
  ): Promise<AiProviderAudioTranscriptionResponse>;
  createImageGeneration(
    request: AiProviderImageGenerationRequest,
  ): Promise<AiProviderImageGenerationResponse>;
}

function buildTextConfig(
  format: AiProviderResponseFormat | undefined,
): ResponseCreateParamsNonStreaming["text"] | undefined {
  if (!format || format.type === "text") {
    return undefined;
  }

  return {
    format: {
      type: "json_schema",
      name: format.name,
      schema: format.schema,
      strict: format.strict ?? true,
    },
  };
}

type OpenAiClientFactory = () => OpenAI;

function isOpenAiClientFactory(
  client: OpenAI | OpenAiClientFactory,
): client is OpenAiClientFactory {
  return typeof client === "function";
}

function buildTranscriptionResponse(
  response: unknown,
): AiProviderAudioTranscriptionResponse {
  const data = response as Partial<AiProviderAudioTranscriptionResponse>;

  return {
    task: "transcribe",
    language: typeof data.language === "string" ? data.language : "",
    duration: typeof data.duration === "number" ? data.duration : 0,
    text: typeof data.text === "string" ? data.text : "",
    segments: Array.isArray(data.segments)
      ? (data.segments as AiProviderAudioTranscriptionSegment[])
      : [],
    raw: response,
  };
}

function mimeTypeFromOutputFormat(
  outputFormat: AiProviderImageGenerationRequest["outputFormat"] = "png",
) {
  if (outputFormat === "jpeg") {
    return "image/jpeg";
  }

  return `image/${outputFormat}`;
}

function imageFileNameFromMimeType(mimeType = "image/png") {
  if (mimeType.includes("jpeg")) return "meal-photo.jpg";
  if (mimeType.includes("webp")) return "meal-photo.webp";
  return "meal-photo.png";
}

function buildImageEditFile(image: AiProviderImageInput) {
  const mimeType = image.mimeType || "image/png";
  return new File(
    [Buffer.from(image.b64Json, "base64")],
    imageFileNameFromMimeType(mimeType),
    { type: mimeType },
  );
}

function firstImageData(response: { data?: Array<{ b64_json?: string }> }) {
  return response.data?.[0]?.b64_json;
}

export class OpenAiProvider implements AiProvider {
  private resolvedClient: OpenAI | null = null;

  constructor(private readonly client: OpenAI | OpenAiClientFactory) {}

  private getClient() {
    if (!this.resolvedClient) {
      this.resolvedClient = isOpenAiClientFactory(this.client)
        ? this.client()
        : this.client;
    }

    return this.resolvedClient;
  }

  async createTextResponse(
    request: AiProviderTextRequest,
  ): Promise<AiProviderTextResponse> {
    const payload: ResponseCreateParamsNonStreaming = {
      model: request.model,
      input: request.input,
      stream: false,
    };

    if (request.instructions) {
      payload.instructions = request.instructions;
    }

    if (request.tools?.length) {
      (payload as unknown as { tools?: AiProviderTextTool[] }).tools = request.tools;
    }

    const text = buildTextConfig(request.format);
    if (text) {
      payload.text = text;
    }

    const response = (await this.getClient().responses.create(
      payload,
    )) as OpenAiResponse;

    return {
      id: response.id,
      outputText: response.output_text ?? "",
      raw: response,
    };
  }

  async createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    const response = await this.getClient().audio.transcriptions.create({
      file: request.file,
      model: request.model,
      response_format: "verbose_json",
      ...(request.language ? { language: request.language } : {}),
      ...(request.prompt ? { prompt: request.prompt } : {}),
    });

    return buildTranscriptionResponse(response);
  }

  async createImageGeneration(
    request: AiProviderImageGenerationRequest,
  ): Promise<AiProviderImageGenerationResponse> {
    const sourceImage = request.originalImages?.find(image => image.b64Json);
    const client = this.getClient();
    const response = sourceImage
      ? await client.images.edit({
          model: request.model,
          image: buildImageEditFile(sourceImage),
          prompt: request.prompt,
          ...(request.size ? { size: request.size } : {}),
          ...(request.quality ? { quality: request.quality } : {}),
        })
      : await client.images.generate({
          model: request.model,
          prompt: request.prompt,
          ...(request.size ? { size: request.size } : {}),
          ...(request.quality ? { quality: request.quality } : {}),
          ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
        });

    const imageData = firstImageData(response);
    if (!imageData) {
      throw new Error("OpenAI image provider returned no image data.");
    }

    return {
      b64Json: imageData,
      mimeType: mimeTypeFromOutputFormat(request.outputFormat),
      raw: response,
    };
  }
}

export type AiProviderFactory = () => AiProvider;

const defaultAiProviderFactory: AiProviderFactory = () =>
  new OpenAiProvider(() => createOpenAiClient());

let aiProviderFactory: AiProviderFactory = defaultAiProviderFactory;

export function createAiProvider(): AiProvider {
  return defaultAiProviderFactory();
}

export function getAiProvider(): AiProvider {
  return aiProviderFactory();
}

export function setAiProviderFactory(factory: AiProviderFactory) {
  aiProviderFactory = factory;
}

export function resetAiProviderFactory() {
  aiProviderFactory = defaultAiProviderFactory;
}
