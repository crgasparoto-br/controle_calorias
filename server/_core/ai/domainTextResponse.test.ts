import { describe, expect, it, vi } from "vitest";
import type {
  AiProvider,
  AiProviderTextRequest,
  AiProviderTextResponse,
} from "../aiProvider";
import { createDomainTextResponse } from "./domainTextResponse";

function providerWithResponses(...responses: AiProviderTextResponse[]) {
  const createTextResponse = vi.fn();
  for (const response of responses) createTextResponse.mockResolvedValueOnce(response);
  return {
    provider: { createTextResponse } as unknown as AiProvider,
    createTextResponse,
  };
}

const structuredSearchRequest = {
  model: "gemini-3.5-flash",
  instructions: "Pesquise o produto e retorne JSON.",
  input: [{ role: "user", content: "KitKat ao leite 41,5g" }],
  tools: [{ type: "web_search" }],
  format: {
    type: "json_schema",
    name: "nutrition",
    schema: {
      type: "object",
      properties: { found: { type: "boolean" } },
      required: ["found"],
    },
  },
} satisfies AiProviderTextRequest;

describe("domain text response boundary", () => {
  it("removes SDK raw payloads from the response exposed to domain services", async () => {
    const provider = {
      createTextResponse: vi.fn(async () => ({
        id: "response-1",
        outputText: "{\"ok\":true}",
        usage: {
          inputTokens: 12,
          outputTokens: 4,
          totalTokens: 16,
          raw: { providerSpecific: "secret-metadata" },
        },
        raw: { sdk: "full-response" },
      })),
    } as unknown as AiProvider;

    const result = await createDomainTextResponse(provider, {
      model: "model-a",
      input: "hello",
    });

    expect(result).toEqual({
      id: "response-1",
      outputText: "{\"ok\":true}",
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
    });
    expect(JSON.stringify(result)).not.toContain("raw");
    expect(JSON.stringify(result)).not.toContain("providerSpecific");
    expect(JSON.stringify(result)).not.toContain("full-response");
  });

  it("recovers citable sources with an evidence-only request while preserving structured output", async () => {
    const primaryOutput = '{"found":true,"evidence":"220 kcal por unidade"}';
    const { provider, createTextResponse } = providerWithResponses(
      {
        id: "primary",
        outputText: primaryOutput,
        raw: {},
        webSearch: { executed: false, sources: [] },
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, raw: {} },
      },
      {
        id: "evidence",
        outputText: "220 kcal por unidade",
        raw: {},
        webSearch: {
          executed: true,
          sources: [{
            url: "https://example.com/kitkat",
            supportingText: ["220 kcal por unidade"],
          }],
          searchQueries: ["KitKat ao leite 41,5g tabela nutricional"],
        },
        usage: { inputTokens: 7, outputTokens: 4, totalTokens: 11, raw: {} },
      },
    );

    const result = await createDomainTextResponse(provider, structuredSearchRequest);

    expect(createTextResponse).toHaveBeenCalledTimes(2);
    expect(createTextResponse.mock.calls[1][0]).toMatchObject({
      model: "gemini-3.5-flash",
      tools: [{ type: "web_search" }],
    });
    expect(createTextResponse.mock.calls[1][0].format).toBeUndefined();
    expect(createTextResponse.mock.calls[1][0].instructions).toContain("evidências da busca web");
    expect(createTextResponse.mock.calls[1][0].instructions).toContain(primaryOutput);
    expect(result.outputText).toBe(primaryOutput);
    expect(result.webSearch).toEqual({
      executed: true,
      sources: [{
        url: "https://example.com/kitkat",
        supportingText: ["220 kcal por unidade"],
      }],
      searchQueries: ["KitKat ao leite 41,5g tabela nutricional"],
    });
    expect(result.usage).toEqual({ inputTokens: 17, outputTokens: 9, totalTokens: 26 });
  });

  it.each([
    ["invalid JSON", "not-json", { executed: true, sources: [{ url: "https://example.com/kitkat" }] }],
    ["functional no-match", '{"found":false}', { executed: true, sources: [{ url: "https://example.com/kitkat" }] }],
    ["missing evidence", '{"found":true,"sourceUrl":"https://example.com/kitkat","evidence":""}', { executed: true, sources: [{ url: "https://example.com/kitkat" }] }],
  ])("does not issue an evidence probe for %s", async (_name, outputText, webSearch) => {
    const { provider, createTextResponse } = providerWithResponses({
      id: "primary",
      outputText,
      raw: {},
      webSearch,
    });

    await createDomainTextResponse(provider, structuredSearchRequest);

    expect(createTextResponse).toHaveBeenCalledTimes(1);
  });

  it("does not issue an evidence probe when the structured response already has evidence-bearing sources", async () => {
    const source = { url: "https://example.com/kitkat", supportingText: ["220 kcal por unidade de 41,5 g"] };
    const { provider, createTextResponse } = providerWithResponses({
      id: "primary",
      outputText: '{"found":true,"sourceUrl":"https://example.com/kitkat","evidence":"dados nutricionais a confirmar"}',
      raw: {},
      webSearch: { executed: true, sources: [source] },
    });

    const result = await createDomainTextResponse(provider, structuredSearchRequest);

    expect(createTextResponse).toHaveBeenCalledTimes(1);
    expect(result.webSearch).toEqual({ executed: true, sources: [source] });
  });

  it("recovers citation-linked evidence for OpenAI when the primary response contains URLs only", async () => {
    const primaryOutput = '{"found":true,"sourceUrl":"https://example.com/kitkat","calories":220,"gramsPerServing":41.5,"evidence":"220 kcal por unidade de 41,5 g"}';
    const { provider, createTextResponse } = providerWithResponses(
      {
        id: "primary-openai",
        outputText: primaryOutput,
        raw: {},
        webSearch: {
          executed: true,
          sources: [{ url: "https://example.com/kitkat" }],
        },
      },
      {
        id: "evidence-openai",
        outputText: "220 kcal por unidade de 41,5 g",
        raw: {},
        webSearch: {
          executed: true,
          sources: [{
            url: "https://example.com/kitkat",
            supportingText: ["220 kcal por unidade de 41,5 g"],
          }],
        },
      },
    );
    const request = {
      ...structuredSearchRequest,
      model: "gpt-4.1-mini",
    } satisfies AiProviderTextRequest;

    const result = await createDomainTextResponse(provider, request);

    expect(createTextResponse).toHaveBeenCalledTimes(2);
    expect(createTextResponse.mock.calls[1][0].format).toBeUndefined();
    expect(result.outputText).toBe(primaryOutput);
    expect(result.webSearch?.sources[0]?.supportingText).toEqual(["220 kcal por unidade de 41,5 g"]);
  });

  it("does not treat free-form probe output as source-linked evidence", async () => {
    const { provider, createTextResponse } = providerWithResponses(
      {
        id: "primary",
        outputText: '{"found":true,"sourceUrl":"https://example.com/kitkat","evidence":"Porção de 41,5 g: 218 kcal, proteínas 2,7 g, carboidratos 26,3 g e gorduras 11,2 g."}',
        raw: {},
        webSearch: { executed: true, searchCount: 1, sources: [{ url: "https://example.com/kitkat" }] },
      },
      {
        id: "probe",
        outputText: "Porção de 41,5 g: 218 kcal, proteínas 2,7 g, carboidratos 26,3 g e gorduras 11,2 g.",
        raw: {},
        webSearch: { executed: true, searchCount: 1, sources: [{ url: "https://example.com/kitkat" }] },
      },
    );

    const request = { ...structuredSearchRequest, model: "gpt-4.1-mini" } satisfies AiProviderTextRequest;
    const result = await createDomainTextResponse(provider, request);

    expect(createTextResponse).toHaveBeenCalledTimes(2);
    expect(result.webSearch).toEqual({
      executed: true,
      searchCount: 2,
      sources: [{ url: "https://example.com/kitkat" }],
    });
  });

  it("keeps multiple URL-only sources without assigning the probe text to any of them", async () => {
    const { provider } = providerWithResponses(
      {
        id: "primary",
        outputText: '{"found":true,"sourceUrl":"https://example.com/a","evidence":"220 kcal por unidade"}',
        raw: {},
        webSearch: {
          executed: true,
          sources: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
        },
      },
      {
        id: "probe",
        outputText: "220 kcal por unidade",
        raw: {},
        webSearch: {
          executed: true,
          sources: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
        },
      },
    );

    const result = await createDomainTextResponse(provider, structuredSearchRequest);

    expect(result.webSearch?.sources).toEqual([
      { url: "https://example.com/a" },
      { url: "https://example.com/b" },
    ]);
    expect(result.webSearch?.sources.every(source => source.supportingText === undefined)).toBe(true);
  });

  it("preserves native support for one source without copying it to URL-only siblings", async () => {
    const { provider } = providerWithResponses(
      {
        id: "primary",
        outputText: '{"found":true,"sourceUrl":"https://example.com/a","evidence":"220 kcal por unidade"}',
        raw: {},
        webSearch: { executed: false, sources: [] },
      },
      {
        id: "probe",
        outputText: "220 kcal por unidade",
        raw: {},
        webSearch: {
          executed: true,
          sources: [
            { url: "https://example.com/a", supportingText: ["220 kcal por unidade"] },
            { url: "https://example.com/b" },
          ],
        },
      },
    );

    const result = await createDomainTextResponse(provider, structuredSearchRequest);

    expect(result.webSearch?.sources).toEqual([
      { url: "https://example.com/a", supportingText: ["220 kcal por unidade"] },
      { url: "https://example.com/b" },
    ]);
  });

  it("does not manufacture evidence when the probe output is empty", async () => {
    const { provider } = providerWithResponses(
      {
        id: "primary",
        outputText: '{"found":true,"sourceUrl":"https://example.com/kitkat","evidence":"dados nutricionais a confirmar"}',
        raw: {},
        webSearch: { executed: true, sources: [{ url: "https://example.com/kitkat" }] },
      },
      {
        id: "probe",
        outputText: "   ",
        raw: {},
        webSearch: { executed: true, sources: [{ url: "https://example.com/kitkat" }] },
      },
    );

    const result = await createDomainTextResponse(provider, structuredSearchRequest);

    expect(result.webSearch).toEqual({ executed: true, sources: [{ url: "https://example.com/kitkat" }] });
  });

  it("does not duplicate an ordinary unstructured web search", async () => {
    const { provider, createTextResponse } = providerWithResponses({
      id: "primary",
      outputText: "resposta",
      raw: {},
      webSearch: { executed: false, sources: [] },
    });
    const request = {
      model: "gemini-3.5-flash",
      input: [{ role: "user", content: "pergunta geral" }],
      tools: [{ type: "web_search" }],
    } satisfies AiProviderTextRequest;

    await createDomainTextResponse(provider, request);

    expect(createTextResponse).toHaveBeenCalledTimes(1);
  });
});
