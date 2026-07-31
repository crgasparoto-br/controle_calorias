import { describe, expect, it } from "vitest";
import type { AiProvider, AiProviderTextRequest, AiProviderTextResponse } from "../../aiProvider";
import { executeResolvedCapability } from "../capabilityExecutor";
import { resolveCapabilityConfig } from "../configResolver";
import { createDomainTextResponse } from "../domainTextResponse";

function fakeProvider(
  handler: (request: AiProviderTextRequest) => AiProviderTextResponse,
): AiProvider {
  return {
    createTextResponse: async request => handler(request),
    createEmbeddings: async () => {
      throw new Error("not implemented for this fake");
    },
    createAudioTranscription: async () => {
      throw new Error("not implemented for this fake");
    },
    createImageGeneration: async () => {
      throw new Error("not implemented for this fake");
    },
  };
}

describe("QUESTION capability runtime contract", () => {
  it("keeps OpenAI eligible because the real consumer requires web search", () => {
    const resolved = resolveCapabilityConfig("QUESTION", {
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_PROVIDER: "openai",
      AI_QUESTION_MODEL: "gpt-4.1-mini",
    } as NodeJS.ProcessEnv);

    expect(resolved.state).toBe("ready");
    expect(resolved.primary).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
  });

  it("rejects Gemini locally while Google Search translation is unavailable", () => {
    const resolved = resolveCapabilityConfig("QUESTION", {
      GEMINI_API_KEY: "gemini-test",
      AI_QUESTION_PROVIDER: "gemini",
      AI_QUESTION_MODEL: "gemini-2.5-flash",
    } as NodeJS.ProcessEnv);

    expect(resolved.state).toBe("invalid");
    expect(resolved.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining("web_search"),
    ]));
  });

  it("executes a resolved QUESTION policy through the canonical executor and surfaces web search execution", async () => {
    const policy = resolveCapabilityConfig("QUESTION", {
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_PROVIDER: "openai",
      AI_QUESTION_MODEL: "gpt-4.1-mini",
    } as NodeJS.ProcessEnv);

    let receivedRequest: AiProviderTextRequest | null = null;
    const provider = fakeProvider(request => {
      receivedRequest = request;
      return {
        id: "resp-1",
        outputText: "Resposta com base em pesquisa web.",
        webSearch: { executed: true, sources: [{ url: "https://example.com", title: "Fonte" }] },
        raw: {},
      };
    });

    const result = await executeResolvedCapability(
      policy,
      attempt =>
        createDomainTextResponse(
          attempt.provider,
          {
            model: attempt.model,
            instructions: "responda com precisão",
            input: [{ role: "user", content: [{ type: "input_text", text: "pergunta" }] }],
            tools: [{ type: "web_search" }],
          },
          { signal: attempt.signal },
        ),
      { providerFactories: { openai: () => provider, "openai-compatible": () => provider, gemini: () => provider } },
    );

    expect(result.value.outputText).toBe("Resposta com base em pesquisa web.");
    expect(result.value.webSearch?.executed).toBe(true);
    expect(result.value.webSearch?.sources).toEqual([{ url: "https://example.com", title: "Fonte" }]);
    expect(receivedRequest?.tools).toEqual([{ type: "web_search" }]);
  });

  it("makes the web search tool available without forcing it in auto mode (tool offered, not required)", async () => {
    const policy = resolveCapabilityConfig("QUESTION", {
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_PROVIDER: "openai",
      AI_QUESTION_MODEL: "gpt-4.1-mini",
    } as NodeJS.ProcessEnv);

    let receivedRequest: AiProviderTextRequest | null = null;
    const provider = fakeProvider(request => {
      receivedRequest = request;
      return {
        id: "resp-2",
        outputText: "Resposta sem necessidade de pesquisa web.",
        webSearch: { executed: false, sources: [] },
        raw: {},
      };
    });

    const result = await executeResolvedCapability(
      policy,
      attempt =>
        createDomainTextResponse(
          attempt.provider,
          {
            model: attempt.model,
            instructions: "responda com precisão",
            input: [{ role: "user", content: [{ type: "input_text", text: "pergunta simples" }] }],
            tools: [{ type: "web_search" }],
          },
          { signal: attempt.signal },
        ),
      { providerFactories: { openai: () => provider, "openai-compatible": () => provider, gemini: () => provider } },
    );

    // The tool was offered on the request (available) but the model chose not to invoke it,
    // and no tool_choice was passed forcing its use — this is the "auto" contract.
    expect(receivedRequest?.tools).toEqual([{ type: "web_search" }]);
    expect((receivedRequest as unknown as { tool_choice?: unknown })?.tool_choice).toBeUndefined();
    expect(result.value.webSearch?.executed).toBe(false);
  });
});
