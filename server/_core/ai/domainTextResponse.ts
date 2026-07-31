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

/**
 * Provider boundary used by domain services. SDK-native `raw` fields remain
 * inside `_core` and are never returned to meal or WhatsApp domain code.
 */
export async function createDomainTextResponse(
  provider: AiProvider,
  request: AiProviderTextRequest,
  options?: AiProviderRequestOptions,
): Promise<AiDomainTextResponse> {
  const response = await provider.createTextResponse(request, options);
  const usage = sanitizeUsage(response.usage);
  return {
    id: response.id,
    outputText: response.outputText,
    ...(usage ? { usage } : {}),
    ...(response.webSearch ? { webSearch: response.webSearch } : {}),
  };
}
