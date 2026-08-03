import type {
  AiProvider,
  AiProviderRequestOptions,
  AiProviderTextRequest,
  AiProviderUsage,
  AiWebSearchResult,
} from "../aiProvider";

export type AiDomainUsage = Omit<AiProviderUsage, "raw">;

export type AiDomainTextResponse = {
  id: string;
  outputText: string;
  usage?: AiDomainUsage;
  /** Present only when a web_search/grounding tool was offered on the request. */
  webSearch?: AiWebSearchResult;
};

function sanitizeUsage(usage: AiProviderUsage | undefined): AiDomainUsage | undefined {
  if (!usage) return undefined;
  return {
    ...(typeof usage.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
    ...(typeof usage.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
    ...(typeof usage.totalTokens === "number" ? { totalTokens: usage.totalTokens } : {}),
  };
}

function combineUsage(
  primary: AiProviderUsage | undefined,
  evidenceProbe: AiProviderUsage | undefined,
): AiDomainUsage | undefined {
  const sanitized = [sanitizeUsage(primary), sanitizeUsage(evidenceProbe)].filter(
    (usage): usage is AiDomainUsage => Boolean(usage),
  );
  if (!sanitized.length) return undefined;

  const sum = (field: keyof AiDomainUsage) => {
    const values = sanitized
      .map(usage => usage[field])
      .filter((value): value is number => typeof value === "number");
    return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
  };

  const inputTokens = sum("inputTokens");
  const outputTokens = sum("outputTokens");
  const totalTokens = sum("totalTokens");
  return {
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function requestsStructuredWebSearch(request: AiProviderTextRequest): boolean {
  return request.format?.type === "json_schema"
    && request.tools?.some(tool => tool.type === "web_search") === true;
}

function hasCitableSources(webSearch: AiWebSearchResult | undefined): boolean {
  return webSearch?.executed === true && webSearch.sources.length > 0;
}

function buildEvidenceProbeRequest(request: AiProviderTextRequest): AiProviderTextRequest {
  const { format: _format, ...withoutFormat } = request;
  const evidenceInstruction = [
    "Esta chamada adicional serve somente para recuperar evidências da busca web.",
    "Execute a busca e responda em texto simples, sem JSON estruturado.",
    "Cite explicitamente nome do produto, porção, calorias, proteínas, carboidratos, gorduras e as fontes usadas.",
  ].join("\n");

  return {
    ...withoutFormat,
    instructions: [request.instructions, evidenceInstruction].filter(Boolean).join("\n"),
  };
}

function selectWebSearch(
  primary: AiWebSearchResult | undefined,
  evidenceProbe: AiWebSearchResult | undefined,
): AiWebSearchResult | undefined {
  if (hasCitableSources(primary)) return primary;
  if (hasCitableSources(evidenceProbe)) return evidenceProbe;
  return primary ?? evidenceProbe;
}

/**
 * Provider boundary used by domain services. SDK-native `raw` fields remain
 * inside `_core` and are never returned to meal or WhatsApp domain code.
 *
 * Gemini may omit `groundingChunks` when Google Search is combined with a JSON
 * schema even though the structured answer was grounded. When a structured
 * search returns no citable source, perform one evidence-only request without
 * the schema and keep the original structured output. Downstream validation
 * still requires the independently returned source/evidence to match.
 */
export async function createDomainTextResponse(
  provider: AiProvider,
  request: AiProviderTextRequest,
  options?: AiProviderRequestOptions,
): Promise<AiDomainTextResponse> {
  const response = await provider.createTextResponse(request, options);
  const evidenceProbe = requestsStructuredWebSearch(request) && !hasCitableSources(response.webSearch)
    ? await provider.createTextResponse(buildEvidenceProbeRequest(request), options)
    : undefined;
  const usage = combineUsage(response.usage, evidenceProbe?.usage);
  const webSearch = selectWebSearch(response.webSearch, evidenceProbe?.webSearch);

  return {
    id: response.id,
    outputText: response.outputText,
    ...(usage ? { usage } : {}),
    ...(webSearch ? { webSearch } : {}),
  };
}
