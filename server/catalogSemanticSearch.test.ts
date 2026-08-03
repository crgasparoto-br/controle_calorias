import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const resolveCapabilityConfigMock = vi.fn();
const executeResolvedCapabilityMock = vi.fn();
const createTextResponseMock = vi.fn();
const createEmbeddingsMock = vi.fn();

vi.mock("./_core/ai/configResolver", () => ({
  resolveCapabilityConfig: (...args: unknown[]) => resolveCapabilityConfigMock(...args),
}));

vi.mock("./_core/ai/capabilityExecutor", () => ({
  executeResolvedCapability: (...args: unknown[]) => executeResolvedCapabilityMock(...args),
}));

vi.mock("./_core/openaiClient", () => ({
  isOpenAiConfigured: vi.fn(() => false),
  createOpenAiClient: vi.fn(),
}));

const READY_POLICY = {
  state: "ready" as const,
  primary: { provider: "openai" as const, model: "gpt-4.1-mini" },
  fallback: { effectivelyEnabled: false },
  timeoutMs: 8000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

const DISABLED_POLICY = {
  state: "disabled" as const,
  primary: null,
  fallback: { effectivelyEnabled: false },
  timeoutMs: 8000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

function mockExecuteWithOutput(
  outputText: string,
  webSearch?: {
    executed: boolean;
    sources: Array<{ url: string; title?: string; supportingText?: string[] }>;
  },
) {
  const parsedOutput = JSON.parse(outputText) as { evidence?: string };
  const normalizedWebSearch = webSearch ?? {
    executed: true,
    sources: [{
      url: "https://www.nestle.com.br/marcas/kitkat",
      supportingText: parsedOutput.evidence ? [parsedOutput.evidence] : [],
    }],
  };
  executeResolvedCapabilityMock.mockImplementation(async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => {
    const value = await operation({
      signal: new AbortController().signal,
      source: "primary",
      attempt: 1,
      timeoutMs: 8000,
      provider: {
        createTextResponse: async (request: unknown) => {
          const response = await createTextResponseMock(request);
          return {
            id: "resp-test",
            outputText: response?.outputText ?? outputText,
            webSearch: normalizedWebSearch,
            raw: response,
          };
        },
      },
      providerId: "openai",
      model: "gpt-4.1-mini",
    });
    return { value, source: "primary", attempts: 1, usedFallback: false };
  });
}

const READY_EMBEDDING_POLICY = {
  state: "ready" as const,
  primary: { provider: "openai" as const, model: "text-embedding-3-small" },
  fallback: { effectivelyEnabled: false },
  timeoutMs: 8000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

const DISABLED_EMBEDDING_POLICY = {
  state: "disabled" as const,
  primary: null,
  fallback: { effectivelyEnabled: false },
  timeoutMs: 8000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

/**
 * Wires executeResolvedCapability to call the operation with a provider whose
 * createEmbeddings delegates to createEmbeddingsMock, mirroring the real
 * AiProvider.createEmbeddings(request, options) contract.
 */
function mockExecuteEmbeddings() {
  executeResolvedCapabilityMock.mockImplementation(async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => {
    const value = await operation({
      signal: new AbortController().signal,
      source: "primary",
      attempt: 1,
      timeoutMs: 8000,
      provider: {
        createEmbeddings: async (request: unknown) => {
          const embeddings = await createEmbeddingsMock(request);
          return { embeddings, raw: {} };
        },
        createTextResponse: async () => {
          throw new Error("createTextResponse must not be used by the EMBEDDING capability path");
        },
      },
      providerId: "openai",
      model: "text-embedding-3-small",
    });
    return { value, source: "primary", attempts: 1, usedFallback: false };
  });
}

const { findPackagedSnackByWebSearch, findCatalogFoodSemantic, resetEmbeddingCache } = await import("./catalogSemanticSearch");

describe("findCatalogFoodSemantic — NUTRITION_SEARCH web fallback (packaged snacks)", () => {
  beforeEach(() => {
    resolveCapabilityConfigMock.mockReset();
    executeResolvedCapabilityMock.mockReset();
    createTextResponseMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("accepts a verifiable source with high confidence and compatible semantic guard", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Tabela nutricional informa 218 kcal por unidade de 41,5 g.",
    }));

    const result = await findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate");

    expect(result).not.toBeNull();
    expect(result?.name).toContain("KitKat");
    expect(result?.calories).toBe(218);
    expect(executeResolvedCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a cited source when the provider appends tracking parameters", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "KITKAT AO LEITE 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://pitterpan.com.br/produto/chocolate-kit-kat-ao-leite-415g-nestle/",
      evidence: "Tabela nutricional informa 218 kcal por unidade de 41,5 g.",
    }), {
      executed: true,
      sources: [{
        url: "https://pitterpan.com.br/produto/chocolate-kit-kat-ao-leite-415g-nestle/?utm_source=openai",
        supportingText: ["Tabela nutricional informa 218 kcal por unidade de 41,5 g."],
      }],
    });

    const result = await findPackagedSnackByWebSearch("kit kat ao leite 41,5g", "chocolate");

    expect(result).not.toBeNull();
    expect(result?.aliases).toContain(
      "fonte: https://pitterpan.com.br/produto/chocolate-kit-kat-ao-leite-415g-nestle/?utm_source=openai",
    );
  });

  it("usa a URL realmente citada quando o JSON fornece uma URL não comprovada", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat ao leite 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 220,
      protein: 3.3,
      carbs: 24,
      fat: 12,
      confidence: 0.95,
      sourceUrl: "https://url-nao-citada.example/produto",
      evidence: "Informação nutricional disponível no site oficial da Nestlé.",
    }), {
      executed: true,
      sources: [
        {
          url: "https://www.nestle.com.br/marcas/chocolates/kitkat?utm_source=openai",
          supportingText: ["([nestle.com.br](https://www.nestle.com.br/marcas/chocolates/kitkat?utm_source=openai))"],
        },
        {
          url: "https://www.nestle.com.br/media/pressreleases/exemplo?utm_source=openai",
          supportingText: [
            "De acordo com a fonte, uma unidade de 41,5 g contém 220 kcal, proteínas 3,3 g, carboidratos 24 g e gorduras totais 12 g. ([nestle.com.br](https://www.nestle.com.br/marcas/chocolates/kitkat?utm_source=openai))",
          ],
        },
      ],
    });

    const result = await findPackagedSnackByWebSearch("kit kat ao leite 41,5g", "chocolate");

    expect(result).not.toBeNull();
    expect(result?.aliases).toContain(
      "fonte: https://www.nestle.com.br/marcas/chocolates/kitkat?utm_source=openai",
    );
    expect(result?.aliases).not.toContain("fonte: https://url-nao-citada.example/produto");
  });

  it("returns null (without fabricating data) when confidence is below the threshold", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate genérico",
      brandName: "",
      servingLabel: "1 unidade",
      gramsPerServing: 40,
      calories: 210,
      protein: 2,
      carbs: 23,
      fat: 12,
      confidence: 0.4,
      sourceUrl: "",
      evidence: "estimativa aproximada",
    }));

    const result = await findPackagedSnackByWebSearch("chocolate misterioso xyz", "chocolate");

    expect(result).toBeNull();
  });

  it.each([
    {
      name: "fonte ausente",
      sourceUrl: "",
      evidence: "Tabela nutricional oficial.",
      webSearch: { executed: true, sources: [{ url: "https://www.nestle.com.br/marcas/kitkat" }] },
    },
    {
      name: "evidência ausente",
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "",
      webSearch: { executed: true, sources: [{ url: "https://www.nestle.com.br/marcas/kitkat" }] },
    },
    {
      name: "ferramenta não executada",
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Tabela nutricional oficial.",
      webSearch: { executed: false, sources: [] },
    },
    {
      name: "URL não citada pelo provider",
      sourceUrl: "https://fonte-inventada.example/produto",
      evidence: "Tabela nutricional oficial.",
      webSearch: { executed: true, sources: [{ url: "https://www.nestle.com.br/marcas/kitkat" }] },
    },
  ])("rejeita resultado pesquisado com $name sem acionar fallback externo", async ({
    sourceUrl,
    evidence,
    webSearch,
  }) => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl,
      evidence,
    }), webSearch);

    const result = await findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).toHaveBeenCalledTimes(1);
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
  });

  it("rejeita fonte que omite qualquer macronutriente estruturado", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Porção de 41,5 g: 218 kcal e proteínas 2,7 g.",
    }), {
      executed: true,
      sources: [{
        url: "https://www.nestle.com.br/marcas/kitkat",
        supportingText: ["Porção de 41,5 g: 218 kcal e proteínas 2,7 g."],
      }],
    });

    const result = await findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).toHaveBeenCalledTimes(1);
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
  });

  it("returns null when the semantic compatibility guard rejects an ambiguous flavor/complement match", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Café com leite condensado",
      brandName: "Outra Marca",
      servingLabel: "1 xícara",
      gramsPerServing: 130,
      calories: 90,
      protein: 2,
      carbs: 14,
      fat: 2,
      confidence: 0.95,
      sourceUrl: "https://example.com/produto",
      evidence: "tabela do fabricante",
    }), {
      executed: true,
      sources: [{ url: "https://example.com/produto" }],
    });

    // Query explicitly asks for sugar-free coffee (canonical qualifier); the
    // returned product name carries an incompatible complement (leite
    // condensado), so the semantic guard must reject the canonical match even
    // though the raw food name is trivially present among its own aliases.
    const result = await findPackagedSnackByWebSearch("café sem açúcar", "cookie");

    expect(result).toBeNull();
  });

  it.each([
    {
      name: "sabor divergente",
      foodName: "kit kat morango 41,5g",
      matchedProductName: "KitKat dark 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
    },
    {
      name: "sabor ausente na entrada genérica",
      foodName: "trento 32g",
      matchedProductName: "Trento Chocolate Branco Dark 32g",
      brandName: "Peccin",
      servingLabel: "1 unidade (32g)",
      gramsPerServing: 32,
    },
    {
      name: "embalagem ausente na entrada genérica",
      foodName: "kit kat",
      matchedProductName: "KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
    },
    {
      name: "embalagem divergente",
      foodName: "kit kat 41,5g",
      matchedProductName: "KitKat 80g",
      brandName: "Nestlé",
      servingLabel: "1 pacote (80g)",
      gramsPerServing: 80,
    },
    {
      name: "marca/produto divergente",
      foodName: "oreo baunilha 90g",
      matchedProductName: "Negresco baunilha 90g",
      brandName: "Nestlé",
      servingLabel: "1 pacote (90g)",
      gramsPerServing: 90,
    },
    {
      name: "SKU totalmente diferente",
      foodName: "sonho de valsa 20g",
      matchedProductName: "Bis branco 126g",
      brandName: "Lacta",
      servingLabel: "1 pacote (126g)",
      gramsPerServing: 126,
    },
  ])("rejeita resultado pesquisado com $name mesmo com fonte e confiança válidas", async ({
    foodName,
    matchedProductName,
    brandName,
    servingLabel,
    gramsPerServing,
  }) => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName,
      brandName,
      servingLabel,
      gramsPerServing,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.95,
      sourceUrl: "https://example.com/produto",
      evidence: "Tabela nutricional oficial do fabricante.",
    }), {
      executed: true,
      sources: [{ url: "https://example.com/produto" }],
    });

    const result = await findPackagedSnackByWebSearch(foodName, "chocolate");

    expect(result).toBeNull();
  });

  it("aceita URI opaca do Gemini quando groundingSupports vincula a evidência à fonte", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Tabela nutricional informa 218 kcal por unidade de 41,5 g.",
    }), {
      executed: true,
      sources: [{
        url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-token",
        title: "Nestlé",
        supportingText: ["Tabela nutricional informa 218 kcal por unidade de 41,5 g."],
      }],
    });

    const result = await findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate");

    expect(result).not.toBeNull();
    expect(result?.aliases).toContain(
      "fonte: https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-token",
    );
  });

  it("rejeita URI opaca quando o grounding não sustenta a evidência nutricional", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Tabela nutricional informa 218 kcal por unidade de 41,5 g.",
    }), {
      executed: true,
      sources: [{
        url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/opaque-token",
        supportingText: ["A página descreve somente a história da marca."],
      }],
    });

    const result = await findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate");

    expect(result).toBeNull();
  });

  it("rejeita URL exata quando o trecho citado não contém evidência nutricional", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Tabela nutricional informa 218 kcal por unidade de 41,5 g.",
    }), {
      executed: true,
      sources: [{
        url: "https://www.nestle.com.br/marcas/kitkat",
        supportingText: ["A página apresenta somente a história institucional da marca."],
      }],
    });

    await expect(findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate")).resolves.toBeNull();
  });

  it.each([
    {
      name: "calorias divergentes no grounding",
      evidence: "Tabela nutricional informa 218 kcal por unidade de 41,5 g.",
      supportingText: "Tabela nutricional informa 100 kcal por unidade de 41,5 g.",
    },
    {
      name: "porção divergente no grounding",
      evidence: "Tabela nutricional informa 218 kcal por unidade de 41,5 g.",
      supportingText: "Tabela nutricional informa 218 kcal por unidade de 30 g.",
    },
    {
      name: "calorias divergentes na evidência estruturada",
      evidence: "Tabela nutricional informa 100 kcal por unidade de 41,5 g.",
      supportingText: "Tabela nutricional informa 100 kcal por unidade de 41,5 g.",
    },
  ])("rejeita $name sem promover o resultado como pesquisado", async ({ evidence, supportingText }) => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence,
    }), {
      executed: true,
      sources: [{
        url: "https://www.nestle.com.br/marcas/kitkat",
        supportingText: [supportingText],
      }],
    });

    const result = await findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("rejeita macronutriente explicitamente contraditório no grounding", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Porção de 41,5 g, 218 kcal, proteína 2,7 g, carboidratos 26,3 g e gorduras 11,2 g.",
    }), {
      executed: true,
      sources: [{
        url: "https://www.nestle.com.br/marcas/kitkat",
        supportingText: ["Porção de 41,5 g, 218 kcal, proteína 9 g, carboidratos 26,3 g e gorduras 11,2 g."],
      }],
    });

    await expect(findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate")).resolves.toBeNull();
  });

  it("classifica JSON inválido dentro da tentativa para permitir o fallback único", async () => {
    resolveCapabilityConfigMock.mockReturnValue({
      ...READY_POLICY,
      fallback: {
        effectivelyEnabled: true,
        provider: "gemini",
        model: "gemini-3.1-pro-preview",
      },
    });

    const validFallbackOutput = JSON.stringify({
      found: true,
      matchedProductName: "Chocolate KitKat 41,5g",
      brandName: "Nestlé",
      servingLabel: "1 unidade (41,5g)",
      gramsPerServing: 41.5,
      calories: 218,
      protein: 2.7,
      carbs: 26.3,
      fat: 11.2,
      confidence: 0.9,
      sourceUrl: "https://www.nestle.com.br/marcas/kitkat",
      evidence: "Tabela nutricional oficial do fabricante.",
    });

    executeResolvedCapabilityMock.mockImplementation(async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => {
      const buildAttempt = (providerId: "openai" | "gemini", outputText: string, source: "primary" | "fallback") => ({
        signal: new AbortController().signal,
        source,
        attempt: source === "primary" ? 1 : 2,
        timeoutMs: 8000,
        providerId,
        model: providerId === "openai" ? "gpt-4.1-mini" : "gemini-3.1-pro-preview",
        provider: {
          createTextResponse: async () => ({
            id: `resp-${providerId}`,
            outputText,
            webSearch: {
              executed: true,
              sources: [{ url: "https://www.nestle.com.br/marcas/kitkat" }],
            },
            raw: {},
          }),
        },
      });

      await expect(operation(buildAttempt("openai", "not-json", "primary")))
        .rejects.toMatchObject({ code: "invalid_json" });
      const value = await operation(buildAttempt("gemini", validFallbackOutput, "fallback"));
      return { value, source: "fallback", attempts: 2, usedFallback: true };
    });

    const result = await findPackagedSnackByWebSearch("kit kat 41,5g", "chocolate");

    expect(result?.name).toContain("KitKat");
    expect(executeResolvedCapabilityMock).toHaveBeenCalledTimes(1);
  });

  it("returns null immediately without calling the network when the capability is disabled", async () => {
    resolveCapabilityConfigMock.mockReturnValue(DISABLED_POLICY);

    const result = await findPackagedSnackByWebSearch("bombom sonho de valsa", "chocolate");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).not.toHaveBeenCalled();
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("treats a functional result without a valid match as a normal return (no retry storm, single provider call)", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_POLICY);
    createTextResponseMock.mockResolvedValue({});
    mockExecuteWithOutput(JSON.stringify({
      found: false,
      matchedProductName: "",
      brandName: "",
      servingLabel: "",
      gramsPerServing: 0,
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0,
      sourceUrl: "",
      evidence: "",
    }));

    const result = await findPackagedSnackByWebSearch("wafer trufa desconhecida", "chocolate");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).toHaveBeenCalledTimes(1);
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
  });
});

describe("findCatalogFoodSemantic — EMBEDDING capability (catalog embedding search)", () => {
  beforeEach(() => {
    resolveCapabilityConfigMock.mockReset();
    executeResolvedCapabilityMock.mockReset();
    createTextResponseMock.mockReset();
    createEmbeddingsMock.mockReset();
    resetEmbeddingCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetEmbeddingCache();
  });

  it("returns a catalog match when the EMBEDDING capability is available", async () => {
    const { getCatalogCache } = await import("./catalogRuntime");
    const catalog = getCatalogCache();
    const targetIndex = catalog.findIndex(food => food.slug === "agua");
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    resolveCapabilityConfigMock.mockImplementation((capability: string) =>
      capability === "EMBEDDING" ? READY_EMBEDDING_POLICY : DISABLED_EMBEDDING_POLICY,
    );
    mockExecuteEmbeddings();

    createEmbeddingsMock.mockImplementation(async (request: { input: string[] }) => {
      if (request.input.length > 1) {
        // Building the full catalog cache: give the target entry a
        // distinguishing vector, everything else orthogonal to it.
        return catalog.map((_, i) => (i === targetIndex ? [1, 0] : [0, 1]));
      }
      // Single query embedding call: aligned with the target vector.
      return [[1, 0]];
    });

    const result = await findCatalogFoodSemantic("agua");

    expect(result?.slug).toBe("agua");
    expect(createEmbeddingsMock).toHaveBeenCalled();
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("degrades to null (textual/canonical fallback upstream) without calling the network when EMBEDDING is disabled", async () => {
    resolveCapabilityConfigMock.mockReturnValue(DISABLED_EMBEDDING_POLICY);

    const result = await findCatalogFoodSemantic("agua");

    expect(result).toBeNull();
    expect(executeResolvedCapabilityMock).not.toHaveBeenCalled();
    expect(createEmbeddingsMock).not.toHaveBeenCalled();
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("never substitutes a text-generation model for missing embeddings", async () => {
    resolveCapabilityConfigMock.mockReturnValue(READY_EMBEDDING_POLICY);
    mockExecuteEmbeddings();
    createEmbeddingsMock.mockResolvedValue([]);

    const result = await findCatalogFoodSemantic("um alimento sem correspondencia plausivel xyz");

    expect(result).toBeNull();
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });

  it("rebuilds the embedding cache when the resolved provider/model changes, avoiding mixed-dimension vectors", async () => {
    const { getCatalogCache } = await import("./catalogRuntime");
    const catalog = getCatalogCache();
    const targetIndex = catalog.findIndex(food => food.slug === "agua");
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    resolveCapabilityConfigMock.mockImplementation((capability: string) =>
      capability === "EMBEDDING" ? READY_EMBEDDING_POLICY : DISABLED_EMBEDDING_POLICY,
    );
    mockExecuteEmbeddings();
    createEmbeddingsMock.mockImplementation(async (request: { input: string[] }) =>
      request.input.length > 1
        ? catalog.map((_, i) => (i === targetIndex ? [1, 0] : [0, 1]))
        : [[1, 0]],
    );

    await findCatalogFoodSemantic("agua");
    const buildCallsAfterFirst = createEmbeddingsMock.mock.calls.length;

    // Same provider/model: cache reused, only the single query embedding is fetched.
    await findCatalogFoodSemantic("agua");
    expect(createEmbeddingsMock.mock.calls.length).toBe(buildCallsAfterFirst + 1);

    // Resolved provider/model changes (e.g. operator reconfigures AI_EMBEDDING_*):
    // the cache must be rebuilt instead of reused across an incompatible vector space.
    const OTHER_MODEL_POLICY = {
      ...READY_EMBEDDING_POLICY,
      primary: { provider: "openai" as const, model: "text-embedding-3-large" },
    };
    resolveCapabilityConfigMock.mockImplementation((capability: string) =>
      capability === "EMBEDDING" ? OTHER_MODEL_POLICY : DISABLED_EMBEDDING_POLICY,
    );
    const callsBeforeRebuild = createEmbeddingsMock.mock.calls.length;
    await findCatalogFoodSemantic("agua");
    // A full catalog rebuild call (multi-input) plus the query call happened,
    // proving the stale-provider cache was discarded rather than reused.
    const callsAfterRebuild = createEmbeddingsMock.mock.calls;
    const rebuildCall = callsAfterRebuild[callsBeforeRebuild];
    expect(rebuildCall[0].input.length).toBeGreaterThan(1);
  });

  it("degrada e invalida o cache quando catálogo e consulta usam modelos efetivos diferentes", async () => {
    const { getCatalogCache } = await import("./catalogRuntime");
    const catalog = getCatalogCache();
    const targetIndex = catalog.findIndex(food => food.slug === "agua");
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    resolveCapabilityConfigMock.mockImplementation((capability: string) =>
      capability === "EMBEDDING" ? READY_EMBEDDING_POLICY : DISABLED_EMBEDDING_POLICY,
    );
    createEmbeddingsMock.mockImplementation(async (request: { input: string[] }) =>
      request.input.length > 1
        ? catalog.map((_, i) => (i === targetIndex ? [1, 0] : [0, 1]))
        : [[1, 0]],
    );

    let execution = 0;
    executeResolvedCapabilityMock.mockImplementation(async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => {
      execution += 1;
      const model = execution === 1 ? "text-embedding-3-large" : "text-embedding-3-small";
      const value = await operation({
        signal: new AbortController().signal,
        source: execution === 1 ? "fallback" : "primary",
        attempt: execution,
        timeoutMs: 8000,
        provider: {
          createEmbeddings: async (request: unknown) => ({
            embeddings: await createEmbeddingsMock(request),
            raw: {},
          }),
        },
        providerId: "openai",
        model,
      });
      return { value, source: execution === 1 ? "fallback" : "primary", attempts: 1, usedFallback: execution === 1 };
    });

    expect(await findCatalogFoodSemantic("agua")).toBeNull();

    mockExecuteEmbeddings();
    expect((await findCatalogFoodSemantic("agua"))?.slug).toBe("agua");
  });
});
