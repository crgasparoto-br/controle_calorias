import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "./aiProvider";

function buildClient(create: ReturnType<typeof vi.fn>) {
  return {
    responses: { create },
    embeddings: { create: vi.fn() },
    audio: { transcriptions: { create: vi.fn() } },
    images: { generate: vi.fn(), edit: vi.fn() },
  } as unknown as OpenAI;
}

describe("OpenAiProvider text tool contract", () => {
  it.each(["web_search", "web_search_preview"] as const)(
    "translates the supported internal %s tool to the SDK web-search contract",
    async type => {
      const create = vi.fn().mockResolvedValue({ id: "resp_1", output_text: "ok" });
      const provider = new OpenAiProvider(buildClient(create));

      await provider.createTextResponse({
        model: "gpt-4.1-mini",
        input: "pesquise banana",
        tools: [{ type }],
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ tools: [{ type: "web_search_preview" }] }),
        undefined,
      );
    },
  );

  it("rejects an unknown internal tool before creating or calling the SDK client", async () => {
    const create = vi.fn();
    const clientFactory = vi.fn(() => buildClient(create));
    const provider = new OpenAiProvider(clientFactory);

    await expect(provider.createTextResponse({
      model: "gpt-4.1-mini",
      input: "pesquise banana",
      tools: [{ type: "unknown_internal_tool" }] as never,
    })).rejects.toMatchObject({ code: "incompatible_operation" });

    expect(clientFactory).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
