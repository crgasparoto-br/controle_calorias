import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import {
  createTranscriptionProviderFactories,
  OpenAiCapabilityTranscriptionProvider,
} from "./transcriptionProvider";

function createClient(response: unknown) {
  const create = vi.fn().mockResolvedValue(response);
  return {
    client: {
      audio: { transcriptions: { create } },
    } as unknown as OpenAI,
    create,
  };
}

function request(model: string) {
  return {
    file: new File([new Uint8Array([1, 2, 3])], "audio.wav", { type: "audio/wav" }),
    model,
    language: "pt",
    prompt: "Transcreva alimentos e porções.",
  };
}

describe("OpenAiCapabilityTranscriptionProvider", () => {
  it("requests verbose_json for whisper-1 and preserves provider segments", async () => {
    const { client, create } = createClient({
      task: "transcribe",
      text: "arroz",
      language: "pt",
      duration: 1.2,
      segments: [{ id: 1, text: "arroz" }],
    });
    const provider = new OpenAiCapabilityTranscriptionProvider(() => client);
    const signal = new AbortController().signal;

    const result = await provider.createAudioTranscription(request("whisper-1"), { signal });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: "verbose_json", model: "whisper-1" }),
      { signal },
    );
    expect(result).toHaveProperty("segments");
  });

  it("requests verbose_json for whisper-1 snapshots", async () => {
    const { client, create } = createClient({ text: "arroz", segments: [] });
    const provider = new OpenAiCapabilityTranscriptionProvider(() => client);

    await provider.createAudioTranscription(request("whisper-1-2026-08-03"));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: "verbose_json",
        model: "whisper-1-2026-08-03",
      }),
      undefined,
    );
  });

  it("requests json for gpt-4o-mini-transcribe and does not fabricate segments", async () => {
    const { client, create } = createClient({
      text: "banana",
      usage: { input_tokens: 11, output_tokens: 2, total_tokens: 13 },
    });
    const provider = new OpenAiCapabilityTranscriptionProvider(() => client);

    const result = await provider.createAudioTranscription(request("gpt-4o-mini-transcribe"));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ response_format: "json", model: "gpt-4o-mini-transcribe" }),
      undefined,
    );
    expect(result).not.toHaveProperty("segments");
    expect(result).toMatchObject({ text: "banana" });
  });

  it("keeps unsupported transcription providers fail-closed", () => {
    const factories = createTranscriptionProviderFactories({});
    expect(() => factories.gemini()).toThrow(
      "Gemini does not implement the TRANSCRIPTION adapter.",
    );
  });
});
