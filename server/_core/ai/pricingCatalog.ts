import type { AiNormalizedUsage } from "./providerBoundary";
import type { AiProviderId } from "./supportMatrix";

export const AI_PRICING_CATALOG_VERSION = "2026-08-05.2";
export const AI_PRICING_CATALOG_EFFECTIVE_DATE = "2026-08-05";

export type AiBillableTool = {
  tool: "web_search";
  executed: boolean;
  billableUnits?: number;
};

export type AiPriceUnit =
  | "million_input_tokens"
  | "million_cached_input_tokens"
  | "million_image_input_tokens"
  | "million_output_tokens"
  | "million_embedding_input_tokens"
  | "audio_minute"
  | "generated_image_low_1024_square"
  | "web_search_call";

export type AiPriceRate = {
  unit: AiPriceUnit;
  priceUsd: number;
  source: string;
};

export type AiModelPrice = {
  provider: AiProviderId;
  /** Immutable snapshot when the provider publishes one. */
  model: string;
  /** Runtime aliases resolved to this catalog snapshot. */
  aliases?: readonly string[];
  rates: {
    input?: AiPriceRate;
    cachedInput?: AiPriceRate;
    imageInput?: AiPriceRate;
    output?: AiPriceRate;
    embeddingInput?: AiPriceRate;
    audio?: AiPriceRate;
    imageOutput?: AiPriceRate;
    webSearch?: AiPriceRate;
  };
};

export const AI_PRICING_CATALOG: readonly AiModelPrice[] = [
  {
    provider: "openai",
    model: "gpt-4.1-mini-2025-04-14",
    aliases: ["gpt-4.1-mini"],
    rates: {
      input: {
        unit: "million_input_tokens",
        priceUsd: 0.4,
        source: "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
      },
      cachedInput: {
        unit: "million_cached_input_tokens",
        priceUsd: 0.1,
        source: "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
      },
      output: {
        unit: "million_output_tokens",
        priceUsd: 1.6,
        source: "https://developers.openai.com/api/docs/models/gpt-4.1-mini",
      },
      webSearch: {
        unit: "web_search_call",
        priceUsd: 0.01,
        source: "https://developers.openai.com/api/docs/pricing",
      },
    },
  },
  {
    provider: "openai",
    model: "text-embedding-3-small",
    aliases: ["text-embedding-3-small"],
    rates: {
      embeddingInput: {
        unit: "million_embedding_input_tokens",
        priceUsd: 0.02,
        source: "https://developers.openai.com/api/docs/models/text-embedding-3-small",
      },
    },
  },
  {
    provider: "openai",
    model: "whisper-1",
    aliases: ["whisper-1"],
    rates: {
      audio: {
        unit: "audio_minute",
        priceUsd: 0.006,
        source: "https://developers.openai.com/api/docs/models/whisper-1",
      },
    },
  },
  {
    provider: "openai",
    model: "gpt-image-1",
    aliases: ["gpt-image-1"],
    rates: {
      input: {
        unit: "million_input_tokens",
        priceUsd: 5,
        source: "https://developers.openai.com/api/docs/models/gpt-image-1",
      },
      cachedInput: {
        unit: "million_cached_input_tokens",
        priceUsd: 1.25,
        source: "https://developers.openai.com/api/docs/models/gpt-image-1",
      },
      imageInput: {
        unit: "million_image_input_tokens",
        priceUsd: 10,
        source: "https://developers.openai.com/api/docs/models/gpt-image-1",
      },
      output: {
        unit: "million_output_tokens",
        priceUsd: 40,
        source: "https://developers.openai.com/api/docs/models/gpt-image-1",
      },
      imageOutput: {
        unit: "generated_image_low_1024_square",
        priceUsd: 0.011,
        source: "https://developers.openai.com/api/docs/models/gpt-image-1",
      },
    },
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    aliases: ["gemini-2.5-flash"],
    rates: {
      input: {
        unit: "million_input_tokens",
        priceUsd: 0.3,
        source: "https://ai.google.dev/gemini-api/docs/pricing",
      },
      cachedInput: {
        unit: "million_cached_input_tokens",
        priceUsd: 0.03,
        source: "https://ai.google.dev/gemini-api/docs/pricing",
      },
      output: {
        unit: "million_output_tokens",
        priceUsd: 2.5,
        source: "https://ai.google.dev/gemini-api/docs/pricing",
      },
      webSearch: {
        unit: "web_search_call",
        priceUsd: 0.035,
        source: "https://ai.google.dev/gemini-api/docs/pricing",
      },
    },
  },
] as const;

function normalizedModel(value: string): string {
  return value.trim().toLowerCase();
}

export function findAiModelPrice(
  provider: AiProviderId,
  model: string,
): AiModelPrice | null {
  const normalized = normalizedModel(model);
  return AI_PRICING_CATALOG.find(entry =>
    entry.provider === provider &&
    (normalizedModel(entry.model) === normalized ||
      entry.aliases?.some(alias => normalizedModel(alias) === normalized))) ?? null;
}

function validUnit(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000;
}

export function sumAiExecutionCostUsd(
  costs: readonly (number | null)[],
): number | null {
  if (!costs.length || costs.some(cost => cost === null)) return null;
  return roundUsd(costs.reduce<number>((total, cost) => total + (cost ?? 0), 0));
}

export function estimateAiCallCostUsd(input: {
  provider: AiProviderId;
  model: string;
  usage?: AiNormalizedUsage;
  tools?: readonly AiBillableTool[];
}): number | null {
  const price = findAiModelPrice(input.provider, input.model);
  if (!price) return null;

  let cost = 0;
  let metered = false;
  const usage = input.usage;

  if (usage) {
    const cached = usage.cachedInputTokens ?? 0;
    const inputTokens = validUnit(usage.inputTokens) ? usage.inputTokens : undefined;
    const imageInputTokens = validUnit(usage.inputImageTokens)
      ? usage.inputImageTokens
      : undefined;

    if (inputTokens !== undefined) {
      if (cached > inputTokens || (imageInputTokens !== undefined && imageInputTokens > inputTokens)) {
        return null;
      }
      // The current normalized usage does not identify how many cached tokens
      // belong to text versus image input. Returning null avoids assigning an
      // image cache hit to the lower text cache rate (or vice versa).
      if (cached > 0 && (imageInputTokens ?? 0) > 0) return null;

      const uncached = inputTokens - cached;
      const imageInput = imageInputTokens ?? 0;
      const commonInput = uncached - imageInput;
      if (commonInput < 0) return null;

      if (commonInput > 0) {
        const rate = price.rates.embeddingInput?.priceUsd ?? price.rates.input?.priceUsd;
        if (rate === undefined) return null;
        cost += commonInput / 1_000_000 * rate;
        metered = true;
      }
      if (imageInput > 0) {
        const rate = price.rates.imageInput?.priceUsd ?? price.rates.input?.priceUsd;
        if (rate === undefined) return null;
        cost += imageInput / 1_000_000 * rate;
        metered = true;
      }
    } else if ((imageInputTokens ?? 0) > 0) {
      const rate = price.rates.imageInput?.priceUsd ?? price.rates.input?.priceUsd;
      if (rate === undefined) return null;
      cost += (imageInputTokens ?? 0) / 1_000_000 * rate;
      metered = true;
    }
    if (cached > 0) {
      if (price.rates.cachedInput === undefined) return null;
      cost += cached / 1_000_000 * price.rates.cachedInput.priceUsd;
      metered = true;
    }
    if (validUnit(usage.outputTokens)) {
      if (price.rates.output === undefined) return null;
      cost += usage.outputTokens / 1_000_000 * price.rates.output.priceUsd;
      metered = true;
    } else if (validUnit(usage.outputImageTokens)) {
      if (price.rates.output === undefined) return null;
      cost += usage.outputImageTokens / 1_000_000 * price.rates.output.priceUsd;
      metered = true;
    }
    if (validUnit(usage.audioSeconds)) {
      if (price.rates.audio === undefined) return null;
      cost += usage.audioSeconds / 60 * price.rates.audio.priceUsd;
      metered = true;
    }
    if (validUnit(usage.generatedImages) && !validUnit(usage.outputImageTokens) && !validUnit(usage.outputTokens)) {
      if (price.rates.imageOutput === undefined) return null;
      cost += usage.generatedImages * price.rates.imageOutput.priceUsd;
      metered = true;
    }
  }

  for (const tool of input.tools ?? []) {
    if (!tool.executed) continue;
    if (!validUnit(tool.billableUnits) || price.rates.webSearch === undefined) return null;
    cost += tool.billableUnits * price.rates.webSearch.priceUsd;
    metered = true;
  }

  return metered ? roundUsd(cost) : null;
}
