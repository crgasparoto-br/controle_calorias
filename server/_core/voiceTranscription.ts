/**
 * Voice transcription helper using the backend AI provider.
 *
 * Frontend implementation guide:
 * 1. Capture audio using MediaRecorder API
 * 2. Upload audio to storage (e.g., S3) to get URL
 * 3. Call transcription with the URL
 *
 * Example usage:
 * ```tsx
 * const transcribeMutation = trpc.voice.transcribe.useMutation({
 *   onSuccess: (data) => {
 *     console.log(data.text);
 *     console.log(data.language);
 *     console.log(data.segments);
 *   }
 * });
 *
 * transcribeMutation.mutate({
 *   audioUrl: uploadedAudioUrl,
 *   language: 'en',
 *   prompt: 'Transcribe the meeting'
 * });
 * ```
 */
import { getAiProvider } from "./aiProvider";
import { ENV } from "./env";

const MAX_AUDIO_FILE_SIZE_BYTES = 16 * 1024 * 1024;
const DEFAULT_AUDIO_MIME_TYPE = "audio/mpeg";

const SUPPORTED_AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/mp3",
  "audio/mpeg",
  "audio/wav",
  "audio/wave",
  "audio/ogg",
  "audio/m4a",
  "audio/mp4",
]);

export type TranscribeOptions = {
  audioUrl: string;
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

export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse;

export type TranscriptionError = {
  error: string;
  code:
    | "FILE_TOO_LARGE"
    | "INVALID_FORMAT"
    | "TRANSCRIPTION_FAILED"
    | "UPLOAD_FAILED"
    | "SERVICE_ERROR";
  details?: string;
};

type DownloadedAudio = {
  buffer: Buffer;
  mimeType: string;
};

function normalizeMimeType(mimeType: string | null) {
  return (mimeType ?? DEFAULT_AUDIO_MIME_TYPE).split(";")[0]?.trim().toLowerCase() || DEFAULT_AUDIO_MIME_TYPE;
}

function isWhisperResponse(value: unknown): value is WhisperResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Partial<WhisperResponse>;
  return (
    response.task === "transcribe" &&
    typeof response.language === "string" &&
    typeof response.duration === "number" &&
    typeof response.text === "string" &&
    Array.isArray(response.segments)
  );
}

async function downloadAudio(audioUrl: string): Promise<DownloadedAudio | TranscriptionError> {
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      return {
        error: "Failed to download audio file",
        code: "INVALID_FORMAT",
        details: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = normalizeMimeType(response.headers.get("content-type"));

    return {
      buffer,
      mimeType,
    };
  } catch {
    return {
      error: "Failed to fetch audio file",
      code: "SERVICE_ERROR",
      details: "Audio file could not be downloaded for transcription.",
    };
  }
}

function buildPrompt(options: TranscribeOptions) {
  if (options.prompt) {
    return options.prompt;
  }

  if (options.language) {
    return `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`;
  }

  return "Transcribe the user's voice to text";
}

function sanitizeProviderError(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return `OpenAI transcription provider returned status ${(error as { status: number }).status}.`;
  }

  return "OpenAI transcription provider request failed.";
}

/**
 * Transcribe audio to text using the internal backend provider.
 */
export async function transcribeAudio(
  options: TranscribeOptions,
): Promise<TranscriptionResponse | TranscriptionError> {
  const downloaded = await downloadAudio(options.audioUrl);
  if ("error" in downloaded) {
    return downloaded;
  }

  if (!SUPPORTED_AUDIO_MIME_TYPES.has(downloaded.mimeType)) {
    return {
      error: "Audio file format is not supported",
      code: "INVALID_FORMAT",
      details: `Unsupported audio MIME type: ${downloaded.mimeType}`,
    };
  }

  if (downloaded.buffer.length > MAX_AUDIO_FILE_SIZE_BYTES) {
    const sizeMB = downloaded.buffer.length / (1024 * 1024);
    return {
      error: "Audio file exceeds maximum size limit",
      code: "FILE_TOO_LARGE",
      details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`,
    };
  }

  try {
    const audioFile = new File(
      [downloaded.buffer],
      `audio.${getFileExtension(downloaded.mimeType)}`,
      { type: downloaded.mimeType },
    );

    const transcription = await getAiProvider().createAudioTranscription({
      file: audioFile,
      model: ENV.openaiTranscriptionModel,
      language: options.language,
      prompt: buildPrompt(options),
    });

    const response: WhisperResponse = {
      task: "transcribe",
      language: transcription.language,
      duration: transcription.duration,
      text: transcription.text,
      segments: transcription.segments,
    };

    if (!isWhisperResponse(response)) {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format",
      };
    }

    return response;
  } catch (error) {
    return {
      error: "Voice transcription failed",
      code: "TRANSCRIPTION_FAILED",
      details: sanitizeProviderError(error),
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

function getLanguageName(langCode: string): string {
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
