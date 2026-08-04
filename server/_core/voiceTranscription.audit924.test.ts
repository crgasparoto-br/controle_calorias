import { describe, expect, it, vi } from "vitest";
import type { AiProvider, AiProviderAudioTranscriptionResponse } from "./aiProvider";
import { AiOperationalError } from "./ai/policyExecutor";
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
  return providerWithCall(vi.fn().mockResolvedValue({
    task: "transcribe",
    text,
    raw: {},
  } satisfies AiProviderAudioTranscriptionResponse));
}

function providerWithCall(
  createAudioTranscription: AiProvider["createAudioTranscription"],
): AiProvider {
  return {
    createAudioTranscription,
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
    "gpt-4.1-mini",
    "whisper-1-2099-01-01",
    "gpt-4o-transcribe-2099-01-01",
    "gpt-4o-transcribe-diarize",
  ])("rejects unapproved OpenAI transcription model before adapter creation: %s", async model => {
    const factory = vi.fn(() => provider("unexpected"));
    const result = await transcribeAudio(audio, {
      env: { ...env(), AI_TRANSCRIPTION_MODEL: model },
      providerFactories: {
        openai: factory,
        gemini: factory,
        "openai-compatible": factory,
      },
    });

    expect(factory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: "INVALID_CONFIGURATION" });
  });

  it("accepts the explicitly approved mini-transcribe snapshot", async () => {
    const call = vi.fn().mockResolvedValue({
      task: "transcribe",
      text: "arroz 100 g",
      raw: {},
    } satisfies AiProviderAudioTranscriptionResponse);
    const factory = vi.fn(() => providerWithCall(call));
    const result = await transcribeAudio(audio, {
      env: { ...env(), AI_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe-2025-12-15" },
      providerFactories: {
        openai: factory,
        gemini: factory,
        "openai-compatible": factory,
      },
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini-transcribe-2025-12-15" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({ text: "arroz 100 g" });
  });

  it("does not create a fallback adapter for an incompatible model", async () => {
    const primaryCall = vi.fn().mockRejectedValue(
      new AiOperationalError("temporary", undefined, "network"),
    );
    const factory = vi.fn(() => providerWithCall(primaryCall));
    const result = await transcribeAudio(audio, {
      env: {
        ...env(),
        AI_TRANSCRIPTION_FALLBACK_ENABLED: "true",
        AI_TRANSCRIPTION_FALLBACK_PROVIDER: "openai",
        AI_TRANSCRIPTION_FALLBACK_MODEL: "gpt-4.1-mini",
      },
      providerFactories: {
        openai: factory,
        gemini: factory,
        "openai-compatible": factory,
      },
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(primaryCall).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ code: "TRANSCRIPTION_FAILED" });
  });

  it("keeps custom model identifiers scoped to an explicitly allowed compatible endpoint", async () => {
    const call = vi.fn().mockResolvedValue({
      task: "transcribe",
      text: "arroz 100 g",
      raw: {},
    } satisfies AiProviderAudioTranscriptionResponse);
    const compatibleFactory = vi.fn(() => providerWithCall(call));
    const result = await transcribeAudio(audio, {
      env: {
        ...env(),
        OPENAI_BASE_URL: "https://compatible.example/v1",
        AI_OPENAI_COMPATIBLE_OPERATIONS: "transcription",
        AI_TRANSCRIPTION_MODEL: "vendor/transcribe-v1",
      },
      providerFactories: {
        openai: () => provider("unexpected"),
        gemini: () => provider("unexpected"),
        "openai-compatible": compatibleFactory,
      },
    });

    expect(compatibleFactory).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ model: "vendor/transcribe-v1" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({
      text: "arroz 100 g",
      provider: "openai-compatible",
    });
  });

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
    "Não há fala no áudio.",
    "O áudio não contém fala.",
    "Não existe voz detectável.",
    "Não foi possível ouvir nada.",
    "Não se ouve voz.",
    "The audio contains no speech.",
    "There is no speech in the audio.",
    "No voice was found in the recording.",
    "Could not hear anything.",
    "I cannot hear anything.",
    "I can't hear anything.",
    "Nothing could be heard.",
    "The recording has no voice.",
    "Não consigo escutar nada.",
    "Nenhum som audível.",
    "No audible speech was detected.",
    "No human voice was detected.",
    "No spoken words were detected.",
    "The recording is silent.",
    "The clip contains silence.",
    "No verbal content was found.",
    "Audio contains only static.",
    "I could not make out any speech.",
    "Could not make out the words.",
    "Nothing intelligible was heard.",
    "Nenhuma fala humana foi detectada.",
    "Não foram detectadas palavras faladas.",
    "A gravação está silenciosa.",
    "O clipe contém apenas estática.",
    "Não foi ouvido conteúdo verbal.",
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

  it.each([
    "[inaudível] arroz 100 g",
    "iogurte sem açúcar",
    "café sem leite",
    "Não comi pão; comi arroz 100 g.",
    "Sem voz no início, depois arroz 100 g.",
  ])(
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
