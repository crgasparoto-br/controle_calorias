import { describe, expect, it } from "vitest";
import {
  AI_PRICING_CATALOG,
  AI_PRICING_CATALOG_VERSION,
  estimateAiCallCostUsd,
  findAiModelPrice,
  sumAiExecutionCostUsd,
} from "../pricingCatalog";

describe("AI pricing catalog", () => {
  it("resolves aliases and estimates cached/token/tool cost deterministically", () => {
    expect(findAiModelPrice("openai", "gpt-4.1-mini")?.model)
      .toBe("gpt-4.1-mini-2025-04-14");

    expect(estimateAiCallCostUsd({
      provider: "openai",
      model: "gpt-4.1-mini",
      usage: {
        inputTokens: 1_000_000,
        cachedInputTokens: 250_000,
        outputTokens: 100_000,
      },
      tools: [{ tool: "web_search", executed: true, billableUnits: 2 }],
    })).toBe(0.505);
    expect(AI_PRICING_CATALOG_VERSION).toBe("2026-08-05.2");
  });

  it("keeps explicit units and official sources for every catalog rate", () => {
    const rates = AI_PRICING_CATALOG.flatMap(entry => Object.values(entry.rates));
    expect(rates.length).toBeGreaterThan(0);
    expect(rates.every(rate => Boolean(rate?.unit))).toBe(true);
    expect(rates.every(rate => Number.isFinite(rate?.priceUsd))).toBe(true);
    expect(rates.every(rate => /^https:\/\/(?:developers\.openai\.com|ai\.google\.dev)\//.test(rate?.source ?? "")))
      .toBe(true);
  });

  it("sums only complete execution estimates and preserves unknown as null", () => {
    expect(sumAiExecutionCostUsd([0.1, 0.02, 0.003])).toBe(0.123);
    expect(sumAiExecutionCostUsd([0.1, null, 0.003])).toBeNull();
    expect(sumAiExecutionCostUsd([])).toBeNull();
  });

  it("does not charge a tool that was merely available", () => {
    expect(estimateAiCallCostUsd({
      provider: "openai",
      model: "gpt-4.1-mini",
      tools: [{ tool: "web_search", executed: false }],
    })).toBeNull();
  });

  it("returns null for unknown price or incomplete billable tool units", () => {
    expect(estimateAiCallCostUsd({
      provider: "openai",
      model: "future-model",
      usage: { inputTokens: 10 },
    })).toBeNull();
    expect(estimateAiCallCostUsd({
      provider: "gemini",
      model: "gemini-2.5-flash",
      tools: [{ tool: "web_search", executed: true }],
    })).toBeNull();
  });

  it("prices image input tokens separately from text and image output tokens", () => {
    expect(estimateAiCallCostUsd({
      provider: "openai",
      model: "gpt-image-1",
      usage: {
        inputTokens: 1_500_000,
        inputImageTokens: 1_000_000,
        outputTokens: 1_000,
      },
    })).toBe(12.54);
    expect(estimateAiCallCostUsd({
      provider: "openai",
      model: "gpt-image-1",
      usage: { inputImageTokens: 1_000_000, outputImageTokens: 1_000 },
    })).toBe(10.04);
  });

  it("returns null when cached mixed-modality input cannot be attributed safely", () => {
    expect(estimateAiCallCostUsd({
      provider: "openai",
      model: "gpt-image-1",
      usage: {
        inputTokens: 1_000_000,
        cachedInputTokens: 100_000,
        inputImageTokens: 500_000,
      },
    })).toBeNull();
  });

  it("prices audio duration and the configured low image output without double counting", () => {
    expect(estimateAiCallCostUsd({
      provider: "openai",
      model: "whisper-1",
      usage: { audioSeconds: 90 },
    })).toBe(0.009);
    expect(estimateAiCallCostUsd({
      provider: "openai",
      model: "gpt-image-1",
      usage: { generatedImages: 1 },
    })).toBe(0.011);
  });
});
