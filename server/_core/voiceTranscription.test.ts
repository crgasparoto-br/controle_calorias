import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiProvider } from "./aiProvider";
import type { AiProviderFactoryMap } from "./ai/providerResolver";
import { AiNonRetryableError, AiOperationalError } from "./ai/policyExecutor";
import { MAX_AUDIO_FILE_SIZE_BYTES, transcribeAudio } from "./voiceTranscription";

const originalFetch = global.fetch;

function provider(call: ReturnType<typeof vi.fn>): AiProvider {
  return {
    createAudioTranscription: call,
    createTextResponse: vi.fn(),
    createEmbeddings: vi.fn(),
    createImageGeneration: vi.fn(),
  } as unknown as AiProvider;
}

function factories(openai: () => AiProvider, gemini = openai): AiProviderFactoryMap {
  return { openai, "openai-compatible": openai, gemini };
}

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    OPENAI_API_KEY: "sk-test",
    AI_TRANSCRIPTION_PROVIDER: "openai",
    ...overrides,
  };
}

function audio(bytes = Buffer.from("synthetic-audio")) {
  return { audioBase64: bytes.toString("base64"), mimeType: "audio/ogg", language: "pt" } as const;
}

function ok(overrides: Record<string, unknown> = {}) {
  return {
    task: "transcribe",
    text: " arroz e feijão ",
    language: "pt",
    duration: 2.4,
    segments: [],
    raw: { private: true },
    ...overrides,
  };
}

describe("TRANSCRIPTION capability", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("preserves whisper-1 and removes raw from the domain result", async () => {
    const call = vi.fn().mockResolvedValue(ok());
    const result = await transcribeAudio(audio(), {
      env: env(),
      providerFactories: factories(() => provider(call)),
    });

    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ model: "whisper-1", language: "pt" }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({
      text: "arroz e feijão",
      provider: "openai",
      model: "whisper-1",
      execution: { source: "primary", attempts: 1, usedFallback: false },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("accepts useful text without optional transcription metadata", async () => {
    const call = vi.fn().mockResolvedValue(ok({
      text: " banana e aveia ",
      language: undefined,
      duration: undefined,
      segments: undefined,
    }));
    const result = await transcribeAudio(audio(), {
      env: env({ AI_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe" }),
      providerFactories: factories(() => provider(call)),
    });

    expect(result).toMatchObject({ text: "banana e aveia", model: "gpt-4o-mini-transcribe" });
    expect(result).not.toHaveProperty("segments");
    expect(result).not.toHaveProperty("language");
    expect(result).not.toHaveProperty("duration");
  });

  it("rejects empty provider output", async () => {
    const call = vi.fn().mockResolvedValue(ok({ text: "   ", segments: undefined }));
    const result = await transcribeAudio(audio(), {
      env: env(),
      providerFactories: factories(() => provider(call)),
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ code: "TRANSCRIPTION_FAILED" });
  });

  it("keeps fallback disabled by default", async () => {
    const primary = vi.fn().mockRejectedValue(new AiOperationalError("temporary", undefined, "network"));
    const factory = vi.fn(() => provider(primary));
    const result = await transcribeAudio(audio(), {
      env: env({
        AI_TRANSCRIPTION_FALLBACK_PROVIDER: "openai",
        AI_TRANSCRIPTION_FALLBACK_MODEL: "gpt-4o-mini-transcribe",
      }),
      providerFactories: factories(factory),
    });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ code: "TRANSCRIPTION_FAILED" });
  });

  it("uses sequential retries and one same-provider fallback", async () => {
    const primary = vi.fn().mockRejectedValue(new AiOperationalError("temporary", undefined, "network"));
    const fallback = vi.fn().mockResolvedValue(ok({ text: "fallback útil", segments: undefined }));
    const factory = vi.fn()
      .mockReturnValueOnce(provider(primary))
      .mockReturnValueOnce(provider(fallback));
    const result = await transcribeAudio(audio(), {
      env: env({
        AI_TRANSCRIPTION_MAX_ATTEMPTS: "2",
        AI_TRANSCRIPTION_FALLBACK_ENABLED: "true",
        AI_TRANSCRIPTION_FALLBACK_PROVIDER: "openai",
        AI_TRANSCRIPTION_FALLBACK_MODEL: "gpt-4o-mini-transcribe",
      }),
      providerFactories: factories(factory),
    });
    expect(primary).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      text: "fallback útil",
      execution: { source: "fallback", attempts: 3, usedFallback: true },
    });
  });

  it("does not fallback on authentication failure", async () => {
    const primary = vi.fn().mockRejectedValue(new AiNonRetryableError("bad key", undefined, "authentication"));
    const fallback = vi.fn().mockResolvedValue(ok());
    const factory = vi.fn()
      .mockReturnValueOnce(provider(primary))
      .mockReturnValueOnce(provider(fallback));
    await transcribeAudio(audio(), {
      env: env({
        AI_TRANSCRIPTION_FALLBACK_ENABLED: "true",
        AI_TRANSCRIPTION_FALLBACK_PROVIDER: "openai",
        AI_TRANSCRIPTION_FALLBACK_MODEL: "gpt-4o-mini-transcribe",
      }),
      providerFactories: factories(factory),
    });
    expect(primary).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("refuses cross-provider fallback without explicit opt-in", async () => {
    const primary = vi.fn().mockRejectedValue(new AiOperationalError("temporary", undefined, "network"));
    const secondary = vi.fn().mockResolvedValue(ok());
    const result = await transcribeAudio(audio(), {
      env: env({
        GEMINI_API_KEY: "gemini-test",
        AI_TRANSCRIPTION_FALLBACK_ENABLED: "true",
        AI_TRANSCRIPTION_FALLBACK_PROVIDER: "gemini",
      }),
      providerFactories: factories(() => provider(primary), () => provider(secondary)),
    });
    expect(secondary).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: "TRANSCRIPTION_FAILED" });
  });

  it.each([
    [{ ...audio(), mimeType: "application/pdf" }, "INVALID_FORMAT"],
    [audio(Buffer.alloc(0)), "EMPTY_FILE"],
    [{ audioBase64: "%%%", mimeType: "audio/ogg" }, "INVALID_FORMAT"],
    [audio(Buffer.alloc(MAX_AUDIO_FILE_SIZE_BYTES + 1, 1)), "FILE_TOO_LARGE"],
  ])("rejects invalid input before provider creation", async (input, code) => {
    const factory = vi.fn(() => provider(vi.fn()));
    const result = await transcribeAudio(input as Parameters<typeof transcribeAudio>[0], {
      env: env(),
      providerFactories: factories(factory),
    });
    expect(factory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code });
  });

  it("fails invalid configuration before provider creation", async () => {
    const factory = vi.fn(() => provider(vi.fn()));
    const result = await transcribeAudio(audio(), {
      env: env({ AI_TRANSCRIPTION_TIMEOUT_MS: "invalid" }),
      providerFactories: factories(factory),
    });
    expect(factory).not.toHaveBeenCalled();
    expect(result).toMatchObject({ code: "INVALID_CONFIGURATION" });
  });
});
