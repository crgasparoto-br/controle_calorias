import { describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "./aiProvider";

describe("OpenAiProvider audio transcription normalization", () => {
  it("does not fabricate language, duration or segments when the provider omits them", async () => {
    const raw = { text: "banana e aveia" };
    const create = vi.fn().mockResolvedValue(raw);
    const provider = new OpenAiProvider({
      audio: { transcriptions: { create } },
    } as never);

    const result = await provider.createAudioTranscription({
      file: new File([new Uint8Array([1, 2, 3])], "audio.ogg", {
        type: "audio/ogg",
      }),
      model: "gpt-4o-mini-transcribe",
      language: "pt",
    });

    expect(result).toEqual({
      task: "transcribe",
      text: "banana e aveia",
      raw,
    });
    expect(result).not.toHaveProperty("language");
    expect(result).not.toHaveProperty("duration");
    expect(result).not.toHaveProperty("segments");
  });
});
