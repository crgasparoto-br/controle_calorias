import type OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";
import { executeWithPolicy } from "./ai/policyExecutor";
import { OpenAiProvider } from "./aiProvider";

function buildClient(overrides: Record<string, unknown> = {}) {
  return {
    responses: { create: vi.fn() },
    embeddings: { create: vi.fn() },
    audio: { transcriptions: { create: vi.fn() } },
    images: { generate: vi.fn(), edit: vi.fn() },
    ...overrides,
  } as unknown as OpenAI;
}

describe("OpenAiProvider", () => {
  it("propagates AbortSignal from executor through the adapter to the SDK", async () => {
    const create = vi.fn((_payload: unknown, options?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }));
    const provider = new OpenAiProvider(buildClient({ responses: { create } }));

    await expect(executeWithPolicy(
      {
        state: "ready",
        maxAttempts: 1,
        timeoutMs: 5,
        fallback: { effectivelyEnabled: false },
      },
      ({ signal }) => provider.createTextResponse(
        {
          model: "gpt-4.1-mini",
          input: [{ role: "user", content: "oi" }],
        },
        { signal },
      ),
      undefined,
      { abortGraceMs: 50 },
    )).rejects.toMatchObject({ code: "timeout" });

    expect(create).toHaveBeenCalledTimes(1);
    const requestOptions = create.mock.calls[0]?.[1];
    expect(requestOptions?.signal).toBeInstanceOf(AbortSignal);
    expect(requestOptions?.signal?.aborted).toBe(true);
  });

  it("implements embeddings and returns normalized vectors and usage", async () => {
    const create = vi.fn().mockResolvedValue({
      data: [
        { embedding: [0.1, 0.2], index: 0, object: "embedding" },
        { embedding: [0.3, 0.4], index: 1, object: "embedding" },
      ],
      model: "text-embedding-3-small",
      object: "list",
      usage: { prompt_tokens: 4, total_tokens: 4 },
    });
    const provider = new OpenAiProvider(buildClient({ embeddings: { create } }));
    const controller = new AbortController();

    const result = await provider.createEmbeddings(
      {
        model: "text-embedding-3-small",
        input: ["banana", "maçã"],
        dimensions: 2,
      },
      { signal: controller.signal },
    );

    expect(create).toHaveBeenCalledWith(
      {
        model: "text-embedding-3-small",
        input: ["banana", "maçã"],
        encoding_format: "float",
        dimensions: 2,
      },
      { signal: controller.signal },
    );
    expect(result.embeddings).toEqual([[0.1, 0.2], [0.3, 0.4]]);
    expect(result.usage).toMatchObject({ inputTokens: 4, totalTokens: 4 });
  });
});
