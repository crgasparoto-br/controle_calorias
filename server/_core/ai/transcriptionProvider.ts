import type OpenAI from "openai";
import type {
  AiProviderAudioTranscriptionRequest,
  AiProviderAudioTranscriptionResponse,
  AiProviderRequestOptions,
  AiProviderUsage,
} from "../aiProvider";
import { OpenAiProvider } from "../aiProvider";
import { ENV } from "../env";
import { createOpenAiClient } from "../openaiClient";
import {
  DEFAULT_AI_PROVIDER_FACTORIES,
  type AiProviderFactoryMap,
} from "./providerResolver";
import { AiNonRetryableError } from "./policyExecutor";

export type OptionalSegmentTranscriptionResponse = Omit<
  AiProviderAudioTranscriptionResponse,
  "language" | "duration" | "segments"
> & {
  language?: string;
  duration?: number;
  segments?: AiProviderAudioTranscriptionResponse["segments"];
  usage?: AiProviderUsage;
};

type OpenAiClientFactory = () => OpenAI;

type OpenAiTranscriptionPayload = {
  file: File;
  model: string;
  response_format: "json" | "verbose_json";
  language?: string;
  prompt?: string;
};

function usesVerboseJson(model: string): boolean {
  return model.trim().toLowerCase() === "whisper-1";
}

function normalizeUsage(value: unknown): AiProviderUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
  };
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  const totalTokens = typeof usage.total_tokens === "number" ? usage.total_tokens : undefined;
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) {
    return undefined;
  }
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    raw: value,
  };
}

function normalizeResponse(response: unknown): OptionalSegmentTranscriptionResponse {
  const data = (response && typeof response === "object" ? response : {}) as Record<string, unknown>;
  const usage = normalizeUsage(data.usage);
  return {
    task: "transcribe",
    text: typeof data.text === "string" ? data.text : "",
    ...(typeof data.language === "string" && data.language.trim()
      ? { language: data.language }
      : {}),
    ...(typeof data.duration === "number" && Number.isFinite(data.duration)
      ? { duration: data.duration }
      : {}),
    ...(Array.isArray(data.segments)
      ? { segments: data.segments as AiProviderAudioTranscriptionResponse["segments"] }
      : {}),
    ...(usage ? { usage } : {}),
    raw: response,
  };
}

/**
 * OpenAI adapter variant dedicated to transcription. The Audio API accepts
 * verbose_json for whisper-1, while GPT-4o transcription models accept json.
 * Keeping this decision inside the adapter prevents SDK details from leaking
 * into the domain and makes segment absence an honest optional capability.
 */
export class OpenAiCapabilityTranscriptionProvider extends OpenAiProvider {
  private resolvedTranscriptionClient: OpenAI | null = null;

  constructor(private readonly transcriptionClientFactory: OpenAiClientFactory) {
    super(transcriptionClientFactory);
  }

  private getTranscriptionClient(): OpenAI {
    this.resolvedTranscriptionClient ??= this.transcriptionClientFactory();
    return this.resolvedTranscriptionClient;
  }

  override async createAudioTranscription(
    request: AiProviderAudioTranscriptionRequest,
    options?: AiProviderRequestOptions,
  ): Promise<AiProviderAudioTranscriptionResponse> {
    const payload: OpenAiTranscriptionPayload = {
      file: request.file,
      model: request.model,
      response_format: usesVerboseJson(request.model) ? "verbose_json" : "json",
      ...(request.language ? { language: request.language } : {}),
      ...(request.prompt ? { prompt: request.prompt } : {}),
    };

    const response = await this.getTranscriptionClient().audio.transcriptions.create(
      payload as Parameters<OpenAI["audio"]["transcriptions"]["create"]>[0],
      options?.signal ? { signal: options.signal } : undefined,
    );

    return normalizeResponse(response) as AiProviderAudioTranscriptionResponse;
  }
}

export function createTranscriptionProviderFactories(
  env: NodeJS.ProcessEnv = process.env,
): AiProviderFactoryMap {
  return {
    ...DEFAULT_AI_PROVIDER_FACTORIES,
    openai: () => new OpenAiCapabilityTranscriptionProvider(() => createOpenAiClient()),
    "openai-compatible": () => {
      const baseURL = (env.OPENAI_BASE_URL ?? ENV.openaiBaseUrl).trim();
      if (!baseURL) {
        throw new AiNonRetryableError(
          "OpenAI-compatible transcription requires OPENAI_BASE_URL.",
          undefined,
          "invalid_configuration",
        );
      }
      return new OpenAiCapabilityTranscriptionProvider(() => createOpenAiClient({ baseURL }));
    },
  };
}
