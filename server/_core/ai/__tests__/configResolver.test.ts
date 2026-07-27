import { describe, expect, it } from "vitest";
import { resolveCapabilityConfig } from "../configResolver";

function envWith(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { ...vars } as unknown as NodeJS.ProcessEnv;
}

describe("capability config resolver", () => {
  it("uses the new AI_<CAPABILITY>_* variable over the legacy one and over the default", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      AI_VISION_PROVIDER: "gemini",
      AI_MEAL_TEXT_PROVIDER: "openai",
      AI_MEAL_TEXT_MODEL: "gpt-custom",
    });
    const resolved = resolveCapabilityConfig("MEAL_TEXT", env);
    expect(resolved.primary).toEqual({ provider: "openai", model: "gpt-custom" });
    expect(resolved.usedLegacyVariables).toBe(false);
    expect(resolved.state).toBe("ready");
  });

  it("falls back to the legacy AI_VISION_PROVIDER variable when the new one is absent", () => {
    const env = envWith({ GEMINI_API_KEY: "g-test", AI_VISION_PROVIDER: "gemini" });
    const resolved = resolveCapabilityConfig("MEAL_VISION", env);
    expect(resolved.primary?.provider).toBe("gemini");
    expect(resolved.usedLegacyVariables).toBe(true);
    expect(resolved.diagnostics.some((d) => d.includes("[deprecated]"))).toBe(true);
  });

  it("falls back to the baseline-equivalent default (openai) when nothing is configured", () => {
    const env = envWith({ OPENAI_API_KEY: "sk-test" });
    const resolved = resolveCapabilityConfig("MEAL_TEXT", env);
    expect(resolved.primary).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
    expect(resolved.usedLegacyVariables).toBe(false);
    expect(resolved.state).toBe("ready");
  });

  it("resolves capabilities independently of one another", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      GEMINI_API_KEY: "g-test",
      AI_VISION_PROVIDER: "gemini",
      AI_QUESTION_PROVIDER: "openai",
    });
    const meal = resolveCapabilityConfig("MEAL_TEXT", env);
    const question = resolveCapabilityConfig("QUESTION", env);
    expect(meal.primary?.provider).toBe("gemini");
    expect(question.primary?.provider).toBe("openai");
  });

  it("keeps fallback disabled by default", () => {
    const env = envWith({ OPENAI_API_KEY: "sk-test" });
    const resolved = resolveCapabilityConfig("QUESTION", env);
    expect(resolved.fallback.requested).toBe(false);
    expect(resolved.fallback.effectivelyEnabled).toBe(false);
  });

  it("enabling fallback for one capability does not affect another", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_FALLBACK_ENABLED: "true",
      AI_QUESTION_FALLBACK_PROVIDER: "openai",
      AI_QUESTION_FALLBACK_MODEL: "gpt-4o-mini",
    });
    const question = resolveCapabilityConfig("QUESTION", env);
    const meal = resolveCapabilityConfig("MEAL_TEXT", env);
    expect(question.fallback.requested).toBe(true);
    expect(question.fallback.effectivelyEnabled).toBe(true);
    expect(meal.fallback.requested).toBe(false);
  });

  it("rejects a different fallback provider when cross-provider flag is not enabled", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      GEMINI_API_KEY: "g-test",
      AI_QUESTION_FALLBACK_ENABLED: "true",
      AI_QUESTION_FALLBACK_PROVIDER: "gemini",
    });
    const resolved = resolveCapabilityConfig("QUESTION", env);
    expect(resolved.fallback.effectivelyEnabled).toBe(false);
    expect(resolved.state).toBe("degraded");
    expect(resolved.diagnostics.some((d) => d.includes("CROSS_PROVIDER_FALLBACK_ENABLED"))).toBe(true);
  });

  it("allows a different fallback provider once cross-provider flag is explicitly enabled", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      GEMINI_API_KEY: "g-test",
      AI_MEAL_TEXT_FALLBACK_ENABLED: "true",
      AI_MEAL_TEXT_FALLBACK_PROVIDER: "gemini",
      AI_MEAL_TEXT_FALLBACK_MODEL: "gemini-2.5-flash",
      AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED: "true",
    });
    const resolved = resolveCapabilityConfig("MEAL_TEXT", env);
    expect(resolved.fallback.effectivelyEnabled).toBe(true);
    expect(resolved.fallback.provider).toBe("gemini");
    expect(resolved.state).toBe("ready");
  });

  it("reports disabled state when the primary provider secret is missing", () => {
    const resolved = resolveCapabilityConfig("QUESTION", envWith({}));
    expect(resolved.state).toBe("disabled");
    expect(resolved.diagnostics.some((d) => d.includes("missing required secret"))).toBe(true);
  });

  it("reports disabled state when fallback secret is also missing", () => {
    const env = envWith({
      AI_QUESTION_FALLBACK_ENABLED: "true",
      AI_QUESTION_FALLBACK_PROVIDER: "openai",
    });
    const resolved = resolveCapabilityConfig("QUESTION", env);
    expect(resolved.state).toBe("disabled");
    expect(resolved.fallback.effectivelyEnabled).toBe(false);
  });

  it("treats an OPENAI_BASE_URL compatible endpoint with non-standard ids as invalid unless validated", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://compatible.example.com/v1",
      AI_NUTRITION_SEARCH_PROVIDER: "openai-compatible",
    });
    const resolved = resolveCapabilityConfig("NUTRITION_SEARCH", env);
    expect(resolved.state).toBe("invalid");
    expect(resolved.diagnostics.some((d) => d.includes("does not support required operation"))).toBe(true);
  });

  it("allows the compatible endpoint once the operation was explicitly validated", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://compatible.example.com/v1",
      AI_NUTRITION_SEARCH_PROVIDER: "openai-compatible",
      AI_OPENAI_COMPATIBLE_OPERATIONS: "embeddings",
    });
    const resolved = resolveCapabilityConfig("NUTRITION_SEARCH", env);
    expect(resolved.state).toBe("ready");
  });

  it("rejects an operation the resolved adapter does not support (gemini transcription)", () => {
    const env = envWith({ GEMINI_API_KEY: "g-test", AI_TRANSCRIPTION_PROVIDER: "gemini" });
    const resolved = resolveCapabilityConfig("TRANSCRIPTION", env);
    expect(resolved.state).toBe("invalid");
  });

  it("marks an unknown provider identifier as invalid, never inferring from a model name", () => {
    const env = envWith({ AI_QUESTION_PROVIDER: "gpt-5-mystery" });
    const resolved = resolveCapabilityConfig("QUESTION", env);
    expect(resolved.state).toBe("invalid");
  });

  it("flags invalid MAX_ATTEMPTS/TIMEOUT_MS but still resolves with defaults", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_TIMEOUT_MS: "not-a-number",
      AI_QUESTION_MAX_ATTEMPTS: "-1",
    });
    const resolved = resolveCapabilityConfig("QUESTION", env);
    expect(resolved.timeoutMs).toBeGreaterThan(0);
    expect(resolved.maxAttempts).toBeGreaterThan(0);
    expect(resolved.diagnostics.some((d) => d.includes("TIMEOUT_MS"))).toBe(true);
    expect(resolved.diagnostics.some((d) => d.includes("MAX_ATTEMPTS"))).toBe(true);
  });

  it("never leaks secret values in diagnostics", () => {
    const env = envWith({ OPENAI_API_KEY: "sk-super-secret-value" });
    const resolved = resolveCapabilityConfig("QUESTION", env);
    const serialized = JSON.stringify(resolved);
    expect(serialized).not.toContain("sk-super-secret-value");
  });
});
