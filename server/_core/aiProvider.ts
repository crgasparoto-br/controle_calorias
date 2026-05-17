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

export type AiProviderTextRequest = {
  model: string;
  instructions?: string;
  input: ResponseCreateParamsNonStreaming["input"];
  format?: AiProviderResponseFormat;
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

export interface AiProvider {
  createTextResponse(
    request: AiProviderTextRequest,
  ): Promise<AiProviderTextResponse>;
  createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
  ): Promise<AiProviderAudioTranscriptionResponse>;
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