import { describe, expect, it } from "vitest";
import { resolveCapabilityConfig } from "../configResolver";

function openAiEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    OPENAI_API_KEY: "test-openai-key",
    ...overrides,
  };
}

describe("WHATSAPP_INTENT canonical configuration", () => {
  it("preserves the established timeout and retry baseline without overrides", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", openAiEnv());

    expect(config.timeoutMs).toBe(8_000);
    expect(config.maxAttempts).toBe(2);
  });

  it("uses explicit capability policy above the baseline", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", openAiEnv({
      AI_WHATSAPP_INTENT_TIMEOUT_MS: "12000",
      AI_WHATSAPP_INTENT_MAX_ATTEMPTS: "3",
      AI_WHATSAPP_INTENT_MODEL: "gpt-whatsapp-canonical",
    }));

    expect(config.timeoutMs).toBe(12_000);
    expect(config.maxAttempts).toBe(3);
    expect(config.primary).toEqual({
      provider: "openai",
      model: "gpt-whatsapp-canonical",
    });
  });

  it("ignores retired OpenAI WhatsApp policy/model aliases", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", openAiEnv({
      OPENAI_WHATSAPP_INTENT_TIMEOUT_MS: "9000",
      OPENAI_WHATSAPP_INTENT_RETRIES: "2",
      OPENAI_WHATSAPP_INTENT_MODEL: "gpt-retired-specific",
      OPENAI_TEXT_MODEL: "gpt-retired-text",
    }));

    expect(config.timeoutMs).toBe(8_000);
    expect(config.maxAttempts).toBe(2);
    expect(config.primary).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
    expect(config.usedLegacyVariables).toBe(false);
    expect(config.diagnostics.some(item => item.includes("[deprecated]"))).toBe(false);
  });

  it("selects Gemini only through the canonical capability provider", () => {
    const config = resolveCapabilityConfig("WHATSAPP_INTENT", {
      GEMINI_API_KEY: "test-gemini-key",
      AI_WHATSAPP_INTENT_PROVIDER: "gemini",
      AI_WHATSAPP_INTENT_MODEL: "gemini-2.5-flash",
      AI_VISION_PROVIDER: "openai",
      OPENAI_TEXT_MODEL: "gpt-retired",
    });

    expect(config.primary).toEqual({ provider: "gemini", model: "gemini-2.5-flash" });
    expect(config.state).toBe("ready");
  });

  it("does not change another capability's common defaults", () => {
    const config = resolveCapabilityConfig("MEAL_TEXT", openAiEnv());

    expect(config.timeoutMs).toBe(30_000);
    expect(config.maxAttempts).toBe(1);
  });
});
