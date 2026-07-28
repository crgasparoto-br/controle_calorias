import { describe, expect, it } from "vitest";
import { resolveCapabilityConfig } from "../configResolver";

function openAiEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OPENAI_API_KEY: "test-openai-key",
    ...overrides,
  };
}

describe("WHATSAPP_INTENT legacy baseline compatibility", () => {
  it("preserves the pre-migration timeout and retry defaults without overrides", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", openAiEnv());

    expect(config.timeoutMs).toBe(8_000);
    expect(config.maxAttempts).toBe(2);
  });

  it("keeps explicit capability policy above the legacy baseline", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", openAiEnv({
      AI_WHATSAPP_INTENT_TIMEOUT_MS: "12000",
      AI_WHATSAPP_INTENT_MAX_ATTEMPTS: "3",
    }));

    expect(config.timeoutMs).toBe(12_000);
    expect(config.maxAttempts).toBe(3);
  });

  it("keeps valid legacy timeout and retry overrides", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", openAiEnv({
      OPENAI_WHATSAPP_INTENT_TIMEOUT_MS: "9000",
      OPENAI_WHATSAPP_INTENT_RETRIES: "2",
    }));

    expect(config.timeoutMs).toBe(9_000);
    expect(config.maxAttempts).toBe(3);
  });

  it("uses OPENAI_TEXT_MODEL only for an OpenAI wire when no more specific model exists", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", openAiEnv({
      OPENAI_TEXT_MODEL: "gpt-text-legacy",
    }));

    expect(config.primary).toEqual({ provider: "openai", model: "gpt-text-legacy" });
    expect(config.usedLegacyVariables).toBe(true);
    expect(config.diagnostics).toContainEqual(expect.stringContaining("OPENAI_TEXT_MODEL"));
  });

  it("does not leak OPENAI_TEXT_MODEL into Gemini", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", {
      AI_VISION_PROVIDER: "gemini",
      GEMINI_API_KEY: "test-gemini-key",
      GEMINI_MODEL: "gemini-intent-legacy",
      OPENAI_TEXT_MODEL: "gpt-must-not-leak",
    });

    expect(config.primary).toEqual({ provider: "gemini", model: "gemini-intent-legacy" });
  });

  it("does not change another capability's common defaults", () => {
    const config = resolveCapabilityConfig("MEAL_TEXT", openAiEnv());

    expect(config.timeoutMs).toBe(30_000);
    expect(config.maxAttempts).toBe(1);
  });
});
