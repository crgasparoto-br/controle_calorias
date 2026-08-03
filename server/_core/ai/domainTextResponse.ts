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

function isCitationMarker(text: string): boolean {
  return /^\s*(?:\(\s*)?\[[^\]]+\]\(https?:\/\/[^)]+\)(?:\s*\))?\s*$/u.test(text);
}

const NUTRITION_RESULT_FIELDS = [
  "gramsPerServing",
  "calories",
  "protein",
  "carbs",
  "fat",
] as const;

function structuredNutritionValues(
  parsed: Record<string, unknown>,
): number[] | null {
  const values = NUTRITION_RESULT_FIELDS.map(field => parsed[field]);
  return values.every((value): value is number => typeof value === "number" && Number.isFinite(value))
    ? values
    : null;
}

function textContainsNumber(text: string, value: number): boolean {
  const candidates = new Set([
    String(value),
    String(value).replace(".", ","),
  ]);
  return [...candidates].some(candidate => new RegExp(
    `(^|[^0-9])${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^0-9]|$)`,
    "u",
  ).test(text));
}

function sourceTextHasNutritionClaim(
  text: string,
  values: number[],
): boolean {
  const [, calories, protein, carbs, fat] = values;
  const calorieClaim = /\b(?:kcal|calorias?)\b/iu.test(text)
    && textContainsNumber(text, calories as number);
  const labelledMacroClaims: Array<[RegExp, number]> = [
    [/\bprote[ií]nas?\b/iu, protein as number],
    [/\bcarboidratos?\b/iu, carbs as number],
    [/\bgorduras?(?:\s+totais?)?\b/iu, fat as number],
  ];
  return calorieClaim || labelledMacroClaims.some(([label, value]) => (
    label.test(text) && textContainsNumber(text, value)
  ));
}

function sourceTextCanSupportStructuredResult(
  text: string,
  parsed: Record<string, unknown>,
): boolean {
  const normalized = text.trim();
  if (!normalized || isCitationMarker(normalized)) return false;
  const nutritionValues = structuredNutritionValues(parsed);
  if (!nutritionValues) return true;

  // A source that already exposes at least one labelled nutrition claim is a
  // functional result, even if downstream validation later rejects it for
  // missing macros. Do not create another outbound recovery call in that case.
  // Product-identification text or serving weight alone remains insufficient and
  // may trigger the single evidence probe.
  return sourceTextHasNutritionClaim(normalized, nutritionValues);
}

function hasCitableSources(
  webSearch: AiWebSearchResult | undefined,
  parsed: Record<string, unknown>,
): boolean {
  return webSearch?.executed === true
    && webSearch.sources.some(source => source.supportingText?.some(text => (
      sourceTextCanSupportStructuredResult(text, parsed)
    )));
}

function shouldRequestEvidenceProbe(
  request: AiProviderTextRequest,
  outputText: string,
  webSearch: AiWebSearchResult | undefined,
): boolean {
  if (!requestsStructuredWebSearch(request)) return false;
  const parsed = parseStructuredSearchOutput(outputText);
  if (
    parsed?.found !== true
    || typeof parsed.evidence !== "string"
    || parsed.evidence.trim().length === 0
  ) return false;
  if (hasCitableSources(webSearch, parsed)) return false;
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
    "Se os dados forem confirmados, escreva uma linha por fonte com porção, calorias, proteínas, carboidratos e gorduras, seguida imediatamente pela citação nativa dessa fonte.",
    "Use somente fonte cuja página exponha literalmente todos esses valores; uma página que apenas identifica o produto é insuficiente.",
    "Não escreva uma linha de dados sem a citação correspondente na mesma linha.",
    "Se não forem confirmados, explique a divergência sem inventar ou adaptar valores.",
    "Resposta estruturada a verificar:",
    structuredOutput,
  ].join("\n");

  return {
    ...withoutFormat,
    instructions: [request.instructions, evidenceInstruction].filter(Boolean).join("\n"),
  };
}

function expandCitationLinkedLines(
  webSearch: AiWebSearchResult | undefined,
  providerOutputText: string | undefined,
): AiWebSearchResult | undefined {
  if (!webSearch || !providerOutputText?.trim()) return webSearch;

  return {
    ...webSearch,
    sources: webSearch.sources.map(source => {
      const expanded = new Set<string>();
      for (const linkedText of source.supportingText ?? []) {
        const normalizedLinkedText = linkedText.trim();
        if (!normalizedLinkedText) continue;
        if (!isCitationMarker(normalizedLinkedText)) {
          expanded.add(normalizedLinkedText);
          continue;
        }
        const markerIndex = providerOutputText.indexOf(normalizedLinkedText);
        if (markerIndex < 0) {
          expanded.add(normalizedLinkedText);
          continue;
        }
        const lineStart = providerOutputText.lastIndexOf("\n", Math.max(0, markerIndex - 1)) + 1;
        const nextLineBreak = providerOutputText.indexOf(
          "\n",
          markerIndex + normalizedLinkedText.length,
        );
        const lineEnd = nextLineBreak === -1 ? providerOutputText.length : nextLineBreak;
        const linkedLine = providerOutputText.slice(lineStart, lineEnd).trim();
        expanded.add(linkedLine || normalizedLinkedText);
      }
      return {
        ...source,
        ...(expanded.size ? { supportingText: [...expanded] } : {}),
      };
    }),
  };
}

function combineWebSearch(
  primary: AiWebSearchResult | undefined,
  evidenceProbe: AiWebSearchResult | undefined,
): AiWebSearchResult | undefined {
  const results = [primary, evidenceProbe].filter(
    (result): result is AiWebSearchResult => Boolean(result),
  );
  if (!results.length) return undefined;

  const sourcesByUrl = new Map<string, AiWebSearchResult["sources"][number]>();
  const searchQueries = new Set<string>();
  let reportedSearchCount = 0;
  let hasReportedSearchCount = false;

  for (const result of results) {
    if (typeof result.searchCount === "number") {
      reportedSearchCount += result.searchCount;
      hasReportedSearchCount = true;
    }
    for (const query of result.searchQueries ?? []) {
      if (query.trim()) searchQueries.add(query.trim());
    }
    for (const source of result.sources) {
      const url = source.url.trim();
      if (!url) continue;
      const existing = sourcesByUrl.get(url);
      const supportingText = new Set(existing?.supportingText ?? []);
      for (const text of source.supportingText ?? []) {
        if (text.trim()) supportingText.add(text.trim());
      }
      sourcesByUrl.set(url, {
        url,
        ...(existing?.title || source.title ? { title: existing?.title ?? source.title } : {}),
        ...(supportingText.size ? { supportingText: [...supportingText] } : {}),
      });
    }
  }

  return {
    executed: results.some(result => result.executed),
    ...(hasReportedSearchCount ? { searchCount: reportedSearchCount } : {}),
    sources: [...sourcesByUrl.values()],
    ...(searchQueries.size ? { searchQueries: [...searchQueries] } : {}),
  };
}

/**
 * Provider boundary used by domain services. SDK-native `raw` fields remain
 * inside `_core` and are never returned to meal or WhatsApp domain code.
 *
 * Providers may return a structured answer and a list of visited URLs without
 * citation-linked supporting text. For structured web searches only, a response
 * without evidence-bearing sources triggers one evidence-only request without the
 * schema. For nutrition-shaped results, a generic cited product description is
 * also insufficient, while a cited nutrition claim is left to the stricter
 * downstream completeness validator without another outbound call. The original
 * structured output remains canonical. The probe's free-form output is never
 * promoted on its own. A provider-linked citation marker may expand only to the
 * exact line that contains that marker; URL-only sources remain without evidence.
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
  const evidenceProbeWebSearch = expandCitationLinkedLines(
    evidenceProbe?.webSearch,
    evidenceProbe?.outputText,
  );
  const webSearch = combineWebSearch(response.webSearch, evidenceProbeWebSearch);

  return {
    id: response.id,
    outputText: response.outputText,
    ...(usage ? { usage } : {}),
    ...(webSearch ? { webSearch } : {}),
  };
}
