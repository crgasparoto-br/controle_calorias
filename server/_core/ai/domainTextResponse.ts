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
  return webSearch?.executed === true
    && webSearch.sources.some(source => source.supportingText?.some(text => text.trim().length > 0));
}

function parseStructuredSearchOutput(outputText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(outputText) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function shouldRequestEvidenceProbe(
  request: AiProviderTextRequest,
  outputText: string,
  webSearch: AiWebSearchResult | undefined,
): boolean {
  if (!requestsStructuredWebSearch(request) || hasCitableSources(webSearch)) return false;
  const parsed = parseStructuredSearchOutput(outputText);
  if (
    parsed?.found !== true
    || typeof parsed.evidence !== "string"
    || parsed.evidence.trim().length === 0
  ) return false;
  if (request.model.startsWith("gemini-")) return true;
  return webSearch?.executed === true
    && webSearch.sources.length > 0
    && typeof parsed.sourceUrl === "string"
    && parsed.sourceUrl.trim().length > 0;
}


function buildEvidenceProbeRequest(
  request: AiProviderTextRequest,
  structuredOutput: string,
): AiProviderTextRequest {
  const { format: _format, ...withoutFormat } = request;
  const evidenceInstruction = [
    "Esta chamada adicional serve somente para recuperar evidências da busca web.",
    "Execute a busca e responda em texto simples, sem JSON estruturado.",
    "Verifique independentemente os dados da resposta estruturada abaixo.",
    "Se os dados forem confirmados, repita literalmente a frase do campo evidence e associe-a às fontes usadas.",
    "Se não forem confirmados, explique a divergência sem inventar ou adaptar valores.",
    "Resposta estruturada a verificar:",
    structuredOutput,
  ].join("\n");

  return {
    ...withoutFormat,
    instructions: [request.instructions, evidenceInstruction].filter(Boolean).join("\n"),
  };
}

function attachProbeEvidence(
  webSearch: AiWebSearchResult | undefined,
  probeOutputText: string | undefined,
): AiWebSearchResult | undefined {
  const supportingText = probeOutputText?.trim();
  if (!webSearch || webSearch.executed !== true || !supportingText) return webSearch;
  return {
    ...webSearch,
    sources: webSearch.sources.map(source => (
      source.supportingText?.some(text => text.trim().length > 0)
        ? source
        : { ...source, supportingText: [supportingText] }
    )),
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
 * Providers may return a structured answer and a list of visited URLs without
 * citation-linked supporting text. For structured web searches only, a response
 * without evidence-bearing sources triggers one evidence-only request without the
 * schema. The original structured output remains canonical, while the probe
 * receives that exact answer so provider-linked supporting text can confirm or
 * refute the same numeric claims. Downstream validation still requires an
 * independently returned source/evidence match.
 */
export async function createDomainTextResponse(
  provider: AiProvider,
  request: AiProviderTextRequest,
  options?: AiProviderRequestOptions,
): Promise<AiDomainTextResponse> {
  const response = await provider.createTextResponse(request, options);
  const evidenceProbe = shouldRequestEvidenceProbe(
  request,
  response.outputText,
  response.webSearch,
)
  ? await provider.createTextResponse(
      buildEvidenceProbeRequest(request, response.outputText),
      options,
    )
  : undefined;
  const usage = combineUsage(response.usage, evidenceProbe?.usage);
  const evidenceProbeWebSearch = attachProbeEvidence(evidenceProbe?.webSearch, evidenceProbe?.outputText);
  const webSearch = selectWebSearch(response.webSearch, evidenceProbeWebSearch);

  return {
    id: response.id,
    outputText: response.outputText,
    ...(usage ? { usage } : {}),
    ...(webSearch ? { webSearch } : {}),
  };
}
