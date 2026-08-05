import type {
  AiProvider,
  AiProviderRequestOptions,
  AiProviderTextRequest,
  AiWebSearchResult,
} from "../aiProvider";
import type { AiNormalizedUsage } from "./providerBoundary";

export type AiDomainUsage = AiNormalizedUsage;

export type AiDomainTextResponse = {
  id: string;
  outputText: string;
  usage?: AiDomainUsage;
  /** Present only when a web_search/grounding tool was offered on the request. */
  webSearch?: AiWebSearchResult;
};

function sanitizeUsage(usage: unknown): AiDomainUsage | undefined {
  const normalized = usage as Partial<AiNormalizedUsage> | undefined;
  if (!normalized) return undefined;
  return {
    ...(typeof normalized.inputTokens === "number" ? { inputTokens: normalized.inputTokens } : {}),
    ...(typeof normalized.cachedInputTokens === "number" ? { cachedInputTokens: normalized.cachedInputTokens } : {}),
    ...(typeof normalized.outputTokens === "number" ? { outputTokens: normalized.outputTokens } : {}),
    ...(typeof normalized.reasoningTokens === "number" ? { reasoningTokens: normalized.reasoningTokens } : {}),
    ...(typeof normalized.totalTokens === "number" ? { totalTokens: normalized.totalTokens } : {}),
    ...(typeof normalized.inputAudioTokens === "number" ? { inputAudioTokens: normalized.inputAudioTokens } : {}),
    ...(typeof normalized.outputAudioTokens === "number" ? { outputAudioTokens: normalized.outputAudioTokens } : {}),
    ...(typeof normalized.inputImageTokens === "number" ? { inputImageTokens: normalized.inputImageTokens } : {}),
    ...(typeof normalized.outputImageTokens === "number" ? { outputImageTokens: normalized.outputImageTokens } : {}),
    ...(typeof normalized.generatedImages === "number" ? { generatedImages: normalized.generatedImages } : {}),
  };
}

function isCitationMarker(text: string): boolean {
  return /^\s*(?:\(\s*)?\[[^\]]+\]\(https?:\/\/[^)]+\)(?:\s*\))?\s*$/u.test(text);
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

/**
 * Provider boundary used by domain services. SDK-native responses are discarded
 * by adapters and are never returned to meal or WhatsApp domain code.
 *
 * One invocation of this boundary performs exactly one provider call. Missing,
 * URL-only or nutritionally insufficient source evidence is preserved as-is so
 * the domain can reject the result and degrade canonically. Recovery calls,
 * retries and fallback are owned exclusively by `executeResolvedCapability`.
 * A provider-linked citation marker may expand only to the exact line that
 * contains that marker; free-form text is never assigned to another source.
 */
export async function createDomainTextResponse(
  provider: AiProvider,
  request: AiProviderTextRequest,
  options?: AiProviderRequestOptions,
): Promise<AiDomainTextResponse> {
  const response = await provider.createTextResponse(request, options);
  const usage = sanitizeUsage(response.usage);
  const webSearch = expandCitationLinkedLines(response.webSearch, response.outputText);

  return {
    id: response.id,
    outputText: response.outputText,
    ...(usage ? { usage } : {}),
    ...(webSearch ? { webSearch } : {}),
  };
}
