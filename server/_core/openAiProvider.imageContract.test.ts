import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "./aiProvider";

function buildClient(edit: ReturnType<typeof vi.fn>, generate = vi.fn()) {
  return {
    responses: { create: vi.fn() },
    embeddings: { create: vi.fn() },
    audio: { transcriptions: { create: vi.fn() } },
    images: { edit, generate },
  } as unknown as OpenAI;
}

describe("OpenAiProvider image contract", () => {
  it("forwards every valid original image and the requested output format to image edits", async () => {
    const edit = vi.fn().mockResolvedValue({ data: [{ b64_json: "RESULT" }] });
    const provider = new OpenAiProvider(buildClient(edit));
    const controller = new AbortController();

    const result = await provider.createImageGeneration({
      model: "gpt-image-1",
      prompt: "anote",
      outputFormat: "webp",
      originalImages: [
        { b64Json: "QUFBQQ==", mimeType: "image/jpeg" },
        { b64Json: "QkJCQg==", mimeType: "image/png" },
      ],
    }, { signal: controller.signal });

    expect(edit).toHaveBeenCalledTimes(1);
    const payload = edit.mock.calls[0][0];
    expect(payload.image).toHaveLength(2);
    expect(payload.image[0]).toBeInstanceOf(File);
    expect(payload.image[1]).toBeInstanceOf(File);
    expect(payload.output_format).toBe("webp");
    expect(edit.mock.calls[0][1]).toEqual({ signal: controller.signal });
    expect(result.mimeType).toBe("image/webp");
  });

  it("rejects an image edit with an empty original image before outbound", async () => {
    const edit = vi.fn();
    const generate = vi.fn();
    const provider = new OpenAiProvider(buildClient(edit, generate));

    await expect(provider.createImageGeneration({
      model: "gpt-image-1",
      prompt: "anote",
      originalImages: [{ b64Json: "" }],
    })).rejects.toMatchObject({ code: "invalid_payload" });

    expect(edit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects a mixed valid and empty image set without discarding the invalid image", async () => {
    const edit = vi.fn();
    const generate = vi.fn();
    const provider = new OpenAiProvider(buildClient(edit, generate));

    await expect(provider.createImageGeneration({
      model: "gpt-image-1",
      prompt: "anote",
      originalImages: [
        { b64Json: "QUFBQQ==", mimeType: "image/jpeg" },
        { b64Json: "   ", mimeType: "image/png" },
      ],
    })).rejects.toMatchObject({ code: "invalid_payload" });

    expect(edit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects malformed non-empty base64 image data before outbound", async () => {
    const edit = vi.fn();
    const generate = vi.fn();
    const provider = new OpenAiProvider(buildClient(edit, generate));

    await expect(provider.createImageGeneration({
      model: "gpt-image-1",
      prompt: "anote",
      originalImages: [{ b64Json: "not-base64!", mimeType: "image/png" }],
    })).rejects.toMatchObject({ code: "invalid_payload" });

    expect(edit).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    { label: "omitted", originalImages: undefined },
    { label: "intentionally empty", originalImages: [] },
  ])("uses generation when originalImages is $label", async ({ originalImages }) => {
    const edit = vi.fn();
    const generate = vi.fn().mockResolvedValue({ data: [{ b64_json: "RESULT" }] });
    const provider = new OpenAiProvider(buildClient(edit, generate));

    await provider.createImageGeneration({
      model: "gpt-image-1",
      prompt: "gere",
      originalImages,
    });

    expect(edit).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
