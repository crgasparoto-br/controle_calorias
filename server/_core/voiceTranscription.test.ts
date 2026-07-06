import { afterEach, describe, expect, it, vi } from "vitest";

type MockFetchResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  headers?: { get: (name: string) => string | null };
};

const originalFetch = global.fetch;

function createAudioFetchResponse(params: {
  mimeType: string;
  bytes: Uint8Array;
}): MockFetchResponse {
  return {
    ok: true,
    arrayBuffer: async () => params.bytes.buffer,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? params.mimeType : null,
    },
  };
}

async function loadModule(provider: { createAudioTranscription: ReturnType<typeof vi.fn> }) {
  vi.resetModules();
  vi.doMock("./aiProvider", () => ({
    OpenAiProvider: class {
      constructor(_client: unknown) {}

      createAudioTranscription = provider.createAudioTranscription;
    },
  }));
  vi.doMock("./openaiClient", () => ({
    createOpenAiClient: () => ({ mocked: true }),
  }));

  return import("./voiceTranscription");
}

describe("voiceTranscription", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("./aiProvider");
    vi.doUnmock("./openaiClient");
  });

  it("uses the configured transcription model and returns the existing whisper-compatible shape", async () => {
    vi.stubEnv("OPENAI_TRANSCRIPTION_MODEL", "whisper-test");
    vi.stubEnv("AI_VISION_PROVIDER", "gemini");

    const createAudioTranscription = vi.fn().mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 2.4,
      text: "arroz e feijao",
      segments: [],
      raw: { mocked: true },
    });

    global.fetch = vi.fn(async () =>
      createAudioFetchResponse({
        mimeType: "audio/ogg",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ) as typeof fetch;

    const { transcribeAudio } = await loadModule({ createAudioTranscription });
    const result = await transcribeAudio({
      audioUrl: "https://storage.test/audio.ogg",
      language: "pt",
    });

    expect(createAudioTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "whisper-test",
        language: "pt",
        prompt: expect.stringContaining("Portuguese"),
      }),
    );

    expect(result).toEqual({
      task: "transcribe",
      language: "pt",
      duration: 2.4,
      text: "arroz e feijao",
      segments: [],
    });
  });

  it("normalizes MIME parameters before validating and creating the audio file", async () => {
    const createAudioTranscription = vi.fn().mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 1,
      text: "banana",
      segments: [],
      raw: { mocked: true },
    });

    const { transcribeAudio } = await loadModule({ createAudioTranscription });
    const result = await transcribeAudio({
      audioBase64: Buffer.from("inline-audio").toString("base64"),
      mimeType: "audio/ogg; codecs=opus",
      language: "pt",
    });

    expect(createAudioTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        file: expect.objectContaining({
          name: "audio.ogg",
          type: "audio/ogg",
        }),
      }),
    );
    expect(result).toEqual({
      task: "transcribe",
      language: "pt",
      duration: 1,
      text: "banana",
      segments: [],
    });
  });

  it("rejects unsupported audio formats before calling the provider", async () => {
    const createAudioTranscription = vi.fn();

    global.fetch = vi.fn(async () =>
      createAudioFetchResponse({
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ) as typeof fetch;

    const { transcribeAudio } = await loadModule({ createAudioTranscription });
    const result = await transcribeAudio({
      audioUrl: "https://storage.test/not-audio.pdf",
    });

    expect(createAudioTranscription).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: "Audio file format is not supported",
      code: "INVALID_FORMAT",
      details: "Unsupported audio MIME type: application/pdf",
    });
  });

  it("rejects oversized audio files before calling the provider", async () => {
    const createAudioTranscription = vi.fn();

    global.fetch = vi.fn(async () =>
      createAudioFetchResponse({
        mimeType: "audio/ogg",
        bytes: new Uint8Array(16 * 1024 * 1024 + 1),
      }),
    ) as typeof fetch;

    const { transcribeAudio } = await loadModule({ createAudioTranscription });
    const result = await transcribeAudio({
      audioUrl: "https://storage.test/large.ogg",
    });

    expect(createAudioTranscription).not.toHaveBeenCalled();
    expect(result).toEqual({
      error: "Audio file exceeds maximum size limit",
      code: "FILE_TOO_LARGE",
      details: "File size is 16.00MB, maximum allowed is 16MB",
    });
  });

  it("returns a sanitized provider failure without leaking upstream details", async () => {
    const createAudioTranscription = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("OPENAI_API_KEY secret leaked"), { status: 503 }));

    global.fetch = vi.fn(async () =>
      createAudioFetchResponse({
        mimeType: "audio/ogg",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ) as typeof fetch;

    const { transcribeAudio } = await loadModule({ createAudioTranscription });
    const result = await transcribeAudio({
      audioUrl: "https://storage.test/failing.ogg",
    });

    expect(result).toEqual({
      error: "Voice transcription failed",
      code: "TRANSCRIPTION_FAILED",
      details: "OpenAI transcription provider returned status 503.",
    });
    expect(JSON.stringify(result)).not.toContain("OPENAI_API_KEY");
    expect(JSON.stringify(result)).not.toContain("secret leaked");
  });
});