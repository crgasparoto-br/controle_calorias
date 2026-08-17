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
  it("translates the internal web_search tool to the stable Responses API contract", async () => {
    const create = vi.fn().mockResolvedValue({ id: "resp_1", output_text: "ok" });
    const provider = new OpenAiProvider(buildClient(create));

    await provider.createTextResponse({
      model: "gpt-4.1-mini",
      input: "pesquise banana",
      tools: [{ type: "web_search" }],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [{ type: "web_search" }],
        include: ["web_search_call.action.sources"],
      }),
      undefined,
    );
  });

  it("normalizes provider queries and sources without duplicating message citations", async () => {
    const create = vi.fn().mockResolvedValue({
      id: "resp_1",
      output_text: "ok",
      output: [
        {
          type: "web_search_call",
          status: "completed",
          action: {
            type: "search",
            query: "banana tabela nutricional",
            sources: [
              { type: "url", url: "https://example.com/banana", title: "Banana" },
              { type: "url", url: "https://example.com/tbca" },
            ],
          },
        },
        {
          type: "message",
          content: [{
            text: "Banana tem 89 kcal por 100 g.",
            annotations: [
              {
                type: "url_citation",
                url: "https://example.com/banana",
                title: "Banana",
                start_index: 0,
                end_index: 30,
              },
            ],
          }],
        },
      ],
    });
    const provider = new OpenAiProvider(buildClient(create));

    const result = await provider.createTextResponse({
      model: "gpt-4.1-mini",
      input: "pesquise banana",
      tools: [{ type: "web_search" }],
    });

    expect(result.webSearch).toEqual({
      executed: true,
      searchCount: 1,
      sources: [
        {
          url: "https://example.com/banana",
          title: "Banana",
          supportingText: ["Banana tem 89 kcal por 100 g."],
        },
        { url: "https://example.com/tbca" },
      ],
      searchQueries: ["banana tabela nutricional"],
    });
  });

  it.each(["web_search_preview", "unknown_internal_tool"])(
    "rejects unsupported internal tool %s before creating or calling the SDK client",
    async type => {
      const create = vi.fn();
      const clientFactory = vi.fn(() => buildClient(create));
      const provider = new OpenAiProvider(clientFactory);

      await expect(provider.createTextResponse({
        model: "gpt-4.1-mini",
        input: "pesquise banana",
        tools: [{ type }] as never,
      })).rejects.toMatchObject({code: "incompatible_operation" });

      expect(clientFactory).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );
});
