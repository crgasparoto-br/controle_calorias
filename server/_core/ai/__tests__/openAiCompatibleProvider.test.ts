import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../aiProvider";
import { OpenAiCompatibleProvider } from "../openAiCompatibleProvider";

function delegate(): AiProvider {
  return {
    createTextResponse: vi.fn(async () => ({
      id: "response-1",
      outputText: "ok",
      raw: {},
    })),
    createEmbeddings: vi.fn(async () => ({ embeddings: [[1]], raw: {} })),
    createAudioTranscription: vi.fn(async () => ({
      task: "transcribe",
      language: "pt",
      duration: 1,
      text: "ok",
      segments: [],
      raw: {},
    })),
    createImageGeneration: vi.fn(async () => ({
      b64Json: "AAAA",
      mimeType: "image/png",
      raw: {},
    })),
  };
}

describe("OpenAiCompatibleProvider operation allowlist", () => {
  it("delegates a plain text request when text is explicitly allowed", async () => {
    const target = delegate();
    const provider = new OpenAiCompatibleProvider(target, ["text"]);

    await expect(provider.createTextResponse({
      model: "vendor/model",
      input: "hello",
    })).resolves.toMatchObject({ outputText: "ok" });

    expect(target.createTextResponse).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      name: "vision",
      call: (provider: OpenAiCompatibleProvider) => provider.createTextResponse({
        model: "vendor/model",
        input: [{
          role: "user",
          content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }],
        }],
      }),
    },
    {
      name: "structured_output",
      call: (provider: OpenAiCompatibleProvider) => provider.createTextResponse({
        model: "vendor/model",
        input: "hello",
        format: { type: "json_schema", name: "result", schema: { type: "object" } },
      }),
    },
    {
      name: "web_search",
      call: (provider: OpenAiCompatibleProvider) => provider.createTextResponse({
        model: "vendor/model",
        input: "hello",
        tools: [{ type: "web_search" }],
      }),
    },
  ])("blocks $name before delegating when only text is allowed", async ({ call }) => {
    const target = delegate();
    const provider = new OpenAiCompatibleProvider(target, ["text"]);

    await expect(call(provider)).rejects.toMatchObject({ code: "incompatible_operation" });
    expect(target.createTextResponse).not.toHaveBeenCalled();
  });

  it("blocks embeddings, transcription, generation and editing independently", async () => {
    const target = delegate();
    const provider = new OpenAiCompatibleProvider(target, ["text"]);

    await expect(provider.createEmbeddings({
      model: "embedding-model",
      input: "banana",
    })).rejects.toMatchObject({ code: "incompatible_operation" });

    await expect(provider.createAudioTranscription({
      model: "audio-model",
      file: new File([], "audio.ogg"),
    })).rejects.toMatchObject({ code: "incompatible_operation" });

    await expect(provider.createImageGeneration({
      model: "image-model",
      prompt: "banana",
    })).rejects.toMatchObject({ code: "incompatible_operation" });

    await expect(provider.createImageGeneration({
      model: "image-model",
      prompt: "annotate",
      originalImages: [{ b64Json: "AAAA", mimeType: "image/png" }],
    })).rejects.toMatchObject({ code: "incompatible_operation" });

    expect(target.createEmbeddings).not.toHaveBeenCalled();
    expect(target.createAudioTranscription).not.toHaveBeenCalled();
    expect(target.createImageGeneration).not.toHaveBeenCalled();
  });

  it("distinguishes image generation from image editing", async () => {
    const generationDelegate = delegate();
    const generation = new OpenAiCompatibleProvider(generationDelegate, ["image_generation"]);
    await generation.createImageGeneration({ model: "image-model", prompt: "banana" });
    expect(generationDelegate.createImageGeneration).toHaveBeenCalledTimes(1);

    const editingDelegate = delegate();
    const editing = new OpenAiCompatibleProvider(editingDelegate, ["image_edit"]);
    await editing.createImageGeneration({
      model: "image-model",
      prompt: "annotate",
      originalImages: [{ b64Json: "AAAA", mimeType: "image/png" }],
    });
    expect(editingDelegate.createImageGeneration).toHaveBeenCalledTimes(1);
  });
});
