/**
 * Capability-governed voice transcription used by web and WhatsApp consumers.
 * Provider/model selection, timeout, retry and fallback are owned by the
 * TRANSCRIPTION capability resolver and common executor.
 */
import type { AiProviderFactoryMap } from "./ai/providerResolver";
import { executeResolvedCapability } from "./ai/capabilityExecutor";
import { resolveCapabilityConfig } from "./ai/configResolver";
import { createDomainAudioTranscription, type AiDomainAudioUsage } from "./ai/domainAudioTranscription";
import {
  AiNonRetryableError,
  AiOperationalError,
} from "./ai/policyExecutor";
import { createTranscriptionProviderFactories } from "./ai/transcriptionProvider";
import type { AiProviderId } from "./ai/supportMatrix";

export const MAX_AUDIO_FILE_SIZE_BYTES = 16 * 1024 * 1024;
const DEFAULT_AUDIO_MIME_TYPE = "audio/mpeg";

export const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/mp3",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/ogg",
  "audio/m4a",
  "audio/mp4",
]);

export type TranscribeOptions =
  | {
      audioUrl: string;
      language?: string;
      prompt?: string;
    }
  | {
      audioBase64: string;
      mimeType?: string;
      language?: string;
      prompt?: string;
    };

export type WhisperSegment = {
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

export type TranscriptionResponse = {
  task: "transcribe";
  text: string;
  provider: AiProviderId;
  model: string;
  language?: string;
  duration?: number;
  segments?: WhisperSegment[];
  usage?: AiDomainAudioUsage;
  execution: {
    source: "primary" | "primary_retry" | "fallback";
    attempts: number;
    usedFallback: boolean;
  };
};

export type TranscriptionError = {
  error: string;
  code:
    | "FILE_TOO_LARGE"
    | "EMPTY_FILE"
    | "INVALID_FORMAT"
    | "INVALID_CONFIGURATION"
    | "TRANSCRIPTION_FAILED"
    | "UPLOAD_FAILED"
    | "SERVICE_ERROR";
  details?: string;
};

export type TranscriptionRuntimeOptions = {
  env?: NodeJS.ProcessEnv;
  providerFactories?: AiProviderFactoryMap;
};

type DownloadedAudio = {
  buffer: Buffer;
  mimeType: string;
};

function normalizeMimeType(mimeType: string | null) {
  return (mimeType ?? DEFAULT_AUDIO_MIME_TYPE).split(";")[0]?.trim().toLowerCase() || DEFAULT_AUDIO_MIME_TYPE;
}

function hasInlineAudio(options: TranscribeOptions): options is Extract<TranscribeOptions, { audioBase64: string }> {
  return "audioBase64" in options;
}

function extractBase64Payload(value: string): { mimeType: string | null; payload: string } {
  const markerIndex = value.indexOf(",");
  if (!value.toLowerCase().startsWith("data:") || markerIndex < 0) {
    return { mimeType: null, payload: value };
  }

  const header = value.slice(5, markerIndex);
  const parts = header.split(";");
  if (parts.at(-1)?.toLowerCase() !== "base64") {
    return { mimeType: null, payload: "" };
  }

  return {
    mimeType: parts[0]?.trim() || null,
    payload: value.slice(markerIndex + 1),
  };
}

function decodeBase64Strict(rawPayload: string): Buffer | null {
  if (rawPayload === "") return Buffer.alloc(0);
  if (/\s/u.test(rawPayload) || !/^[A-Za-z0-9+/]*={0,2}$/u.test(rawPayload)) {
    return null;
  }
  const paddingLength = rawPayload.endsWith("==") ? 2 : rawPayload.endsWith("=") ? 1 : 0;
  const dataLength = rawPayload.length - paddingLength;
  const remainder = dataLength % 4;
  if (remainder === 1) return null;
  const expectedPadding = remainder === 0 ? 0 : 4 - remainder;
  if (paddingLength > 0 && (rawPayload.length % 4 !== 0 || paddingLength !== expectedPadding)) {
    return null;
  }

  const padded = rawPayload.padEnd(Math.ceil(rawPayload.length / 4) * 4, "=");
  const decoded = Buffer.from(padded, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/u, "");
  return canonical === rawPayload.replace(/=+$/u, "") ? decoded : null;
}

function decodeInlineAudio(
  options: Extract<TranscribeOptions, { audioBase64: string }>,
): DownloadedAudio | TranscriptionError {
  const extracted = extractBase64Payload(options.audioBase64);
  const maximumEncodedLength = Math.ceil(MAX_AUDIO_FILE_SIZE_BYTES / 3) * 4 + 4;
  if (extracted.payload.length > maximumEncodedLength) {
    return {
      error: "Audio file exceeds maximum size limit",
      code: "FILE_TOO_LARGE",
      details: "Inline audio payload exceeds the 16MB decoded size limit.",
    };
  }
  const decoded = decodeBase64Strict(extracted.payload);
  if (!decoded) {
    return {
      error: "Failed to decode inline audio",
      code: "INVALID_FORMAT",
      details: "Inline audio payload is not canonical base64 data.",
    };
  }

  return {
    buffer: decoded,
    mimeType: normalizeMimeType(options.mimeType ?? extracted.mimeType),
  };
}

async function downloadAudio(audioUrl: string): Promise<DownloadedAudio | TranscriptionError> {
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      return {
        error: "Failed to download audio file",
        code: "INVALID_FORMAT",
        details: `Audio download returned HTTP ${response.status}.`,
      };
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mimeType: normalizeMimeType(response.headers.get("content-type")),
    };
  } catch {
    return {
      error: "Failed to fetch audio file",
      code: "SERVICE_ERROR",
      details: "Audio file could not be downloaded for transcription.",
    };
  }
}

function validateAudio(audio: DownloadedAudio): TranscriptionError | null {
  if (!SUPPORTED_AUDIO_MIME_TYPES.has(audio.mimeType)) {
    return {
      error: "Audio file format is not supported",
      code: "INVALID_FORMAT",
      details: `Unsupported audio MIME type: ${audio.mimeType}`,
    };
  }
  if (audio.buffer.length === 0) {
    return {
      error: "Audio file is empty",
      code: "EMPTY_FILE",
      details: "Audio payload must contain at least one byte.",
    };
  }
  if (audio.buffer.length > MAX_AUDIO_FILE_SIZE_BYTES) {
    const sizeMB = audio.buffer.length / (1024 * 1024);
    return {
      error: "Audio file exceeds maximum size limit",
      code: "FILE_TOO_LARGE",
      details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`,
    };
  }
  return null;
}

function buildPrompt(options: TranscribeOptions) {
  if (options.prompt) return options.prompt;
  if (options.language) {
    return `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`;
  }
  return "Transcribe the user's voice to text";
}

function toFileBuffer(buffer: Buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

function sanitizeExecutionError(error: unknown): string {
  if (error instanceof AiOperationalError) {
    return `Transcription provider failed with a recoverable ${error.code} condition.`;
  }
  if (error instanceof AiNonRetryableError) {
    return `Transcription request was rejected with classification ${error.code}.`;
  }
  return "Transcription provider request failed.";
}

function configurationError(state: string): TranscriptionError {
  return {
    error: "Voice transcription is unavailable",
    code: "INVALID_CONFIGURATION",
    details: `TRANSCRIPTION capability is not executable (state=${state}).`,
  };
}

/**
 * Transcribe audio using the capability-specific provider/model and the common
 * timeout/retry/fallback policy. Invalid input and invalid configuration fail
 * before any provider adapter is instantiated.
 */
export async function transcribeAudio(
  options: TranscribeOptions,
  runtime: TranscriptionRuntimeOptions = {},
): Promise<TranscriptionResponse | TranscriptionError> {
  const env = runtime.env ?? process.env;
  const config = resolveCapabilityConfig("TRANSCRIPTION", env);
  if (config.state !== "ready" && config.state !== "degraded") {
    return configurationError(config.state);
  }

  const downloaded = hasInlineAudio(options)
    ? decodeInlineAudio(options)
    : await downloadAudio(options.audioUrl);
  if ("error" in downloaded) return downloaded;

  const validationError = validateAudio(downloaded);
  if (validationError) return validationError;

  const audioFile = new File(
    [toFileBuffer(downloaded.buffer)],
    `audio.${getFileExtension(downloaded.mimeType)}`,
    { type: downloaded.mimeType },
  );

  try {
    const result = await executeResolvedCapability(
      config,
      async context => {
        const transcription = await createDomainAudioTranscription(
          context.provider,
          {
            file: audioFile,
            model: context.model,
            language: options.language,
            prompt: buildPrompt(options),
          },
          { signal: context.signal },
        );
        return {
          ...transcription,
          provider: context.providerId,
          model: context.model,
        };
      },
      {
        providerFactories:
          runtime.providerFactories ?? createTranscriptionProviderFactories(env),
      },
    );

    return {
      ...result.value,
      execution: {
        source: result.source,
        attempts: result.attempts,
        usedFallback: result.usedFallback,
      },
    };
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "TRANSCRIPTION_FAILED",
      details: sanitizeExecutionError(error),
    };
  }
}

function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm",
    "audio/mp3": "mp3",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
  };
  return mimeToExt[mimeType] || "audio";
}

function getLanguageName(langCode: string) {
  const langMap: Record<string, string> = {
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    ar: "Arabic",
    hi: "Hindi",
    nl: "Dutch",
    pl: "Polish",
    tr: "Turkish",
    sv: "Swedish",
    da: "Danish",
    no: "Norwegian",
    fi: "Finnish",
  };
  return langMap[langCode] || langCode;
}
