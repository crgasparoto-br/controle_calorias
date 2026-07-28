import { ENV } from "../env";
import { GeminiProvider } from "../geminiProvider";
import { OpenAiProvider, type AiProvider, type AiProviderFactory } from "../aiProvider";
import { createOpenAiClient } from "../openaiClient";
import type { AiProviderId } from "./supportMatrix";

export type AiProviderFactoryMap = Record<AiProviderId, AiProviderFactory>;

const createOpenAiAdapter: AiProviderFactory = () =>
  new OpenAiProvider(() => createOpenAiClient());

const createGeminiAdapter: AiProviderFactory = () => {
  if (!ENV.geminiApiKey) {
    throw new Error(
      "Gemini provider was selected for an AI capability but GEMINI_API_KEY is not configured.",
    );
  }
  return new GeminiProvider(ENV.geminiApiKey);
};

export const DEFAULT_AI_PROVIDER_FACTORIES: AiProviderFactoryMap = {
  openai: createOpenAiAdapter,
  "openai-compatible": createOpenAiAdapter,
  gemini: createGeminiAdapter,
};

/**
 * Converts an explicitly resolved provider identifier into its adapter.
 * Provider selection is never inferred from the model name or a global default.
 */
export function getAiProviderById(
  provider: AiProviderId,
  factories: AiProviderFactoryMap = DEFAULT_AI_PROVIDER_FACTORIES,
): AiProvider {
  return factories[provider]();
}
