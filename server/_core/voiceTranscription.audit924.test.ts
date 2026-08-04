import { describe, expect, it, vi } from "vitest";
import type { AiProvider, AiProviderAudioTranscriptionResponse } from "./aiProvider";
import { transcribeAudio } from "./voiceTranscription";

function env(): NodeJS.ProcessEnv {
  return {
    AI_TRANSCRIPTION_PROVIDER: "openai",
    AI_TRANSCRIPTION_MODEL: "whisper-1",
    AI_TRANSCRIPTION_TIMEOUT_MS: "1000",
    AI_TRANSCRIPTION_MAX_ATTEMPTS: "1",
    AI_TRANSCRIPTION_FALLBACK_ENABLED: "false",
    OPENAI_API_KEY: "test-key",
  };
}

function provider(text: string): AiProvider {
  return {
    createAudioTranscription: vi.fn().mockResolvedValue({
      task: "transcribe",
      text,
      raw: {},
    } satisfies AiProviderAudioTranscriptionResponse),
    createTextResponse: vi.fn(),
    createEmbeddings: vi.fn(),
    createImageGeneration: vi.fn(),
  };
}

function factories(text: string) {
  return {
    openai: () => provider(text),
    gemini: () => provider(text),
    "openai-compatible": () => provider(text),
  };
}

const audio = {
  audioBase64: Buffer.from("audio").toString("base64"),
  mimeType: "audio/mpeg",
} as const;

describe("issue #924 audit regressions", () => {
  it.each([
    "Silêncio detectado.",
    "Não foi possível detectar fala.",
    "Não consegui entender o áudio.",
    "Nenhuma voz detectada.",
    "Somente ruído de fundo.",
    "Áudio sem conteúdo.",
    "No speech detected in the audio.",
    "Only background noise.",
    "Could not understand the audio. Please try again.",
  ])("rejects marker-only provider output: %s", async text => {
    const result = await transcribeAudio(audio, {
      env: env(),
      providerFactories: factories(text),
    });

    expect(result).toMatchObject({
      code: "TRANSCRIPTION_FAILED",
      details: "Transcription provider failed with a recoverable empty_output condition.",
    });
  });

  it.each(["[inaudível] arroz 100 g", "iogurte sem açúcar"])(
    "preserves actionable mixed speech: %s",
    async text => {
      const result = await transcribeAudio(audio, {
        env: env(),
        providerFactories: factories(text),
      });

      expect(result).toMatchObject({ text });
    },
  );
});
