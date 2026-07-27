import { describe, expect, it } from "vitest";
import { resolveCapabilityConfig } from "../configResolver";

function envWith(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { ...vars } as NodeJS.ProcessEnv;
}

describe("capability config resolver", () => {
  it("uses new variables before legacy variables and defaults", () => {
    const resolved = resolveCapabilityConfig("MEAL_TEXT", envWith({
      OPENAI_API_KEY: "sk-test",
      AI_VISION_PROVIDER: "gemini",
      GEMINI_MODEL: "gemini-legacy",
      AI_MEAL_TEXT_PROVIDER: "openai",
      AI_MEAL_TEXT_MODEL: "gpt-new",
    }));
    expect(resolved.primary).toEqual({ provider: "openai", model: "gpt-new" });
    expect(resolved.usedLegacyVariables).toBe(false);
    expect(resolved.state).toBe("ready");
  });

  it("preserves legacy Gemini provider and GEMINI_MODEL precedence", () => {
    const resolved = resolveCapabilityConfig("MEAL_VISION", envWith({
      GEMINI_API_KEY: "g-test",
      AI_VISION_PROVIDER: "gemini",
      GEMINI_MODEL: "gemini-custom-legacy",
      OPENAI_MODEL: "must-not-leak",
    }));
    expect(resolved.primary).toEqual({
      provider: "gemini",
      model: "gemini-custom-legacy",
    });
    expect(resolved.usedLegacyVariables).toBe(true);
    expect(resolved.diagnostics.filter((item) => item.includes("[deprecated]")).length).toBe(2);
  });

  it("preserves legacy OpenAI model for meal capabilities", () => {
    const resolved = resolveCapabilityConfig("MEAL_TEXT", envWith({
      OPENAI_API_KEY: "sk-test",
      OPENAI_MODEL: "gpt-legacy-custom",
    }));
    expect(resolved.primary).toEqual({
      provider: "openai",
      model: "gpt-legacy-custom",
    });
  });

  it("uses baseline-equivalent defaults when nothing is configured", () => {
    const resolved = resolveCapabilityConfig("MEAL_TEXT", envWith({ OPENAI_API_KEY: "sk-test" }));
    expect(resolved.primary).toEqual({ provider: "openai", model: "gpt-4.1-mini" });
    expect(resolved.state).toBe("ready");
  });

  it("resolves capabilities independently", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      GEMINI_API_KEY: "g-test",
      AI_VISION_PROVIDER: "gemini",
      AI_QUESTION_PROVIDER: "openai",
    });
    expect(resolveCapabilityConfig("MEAL_TEXT", env).primary?.provider).toBe("gemini");
    expect(resolveCapabilityConfig("QUESTION", env).primary?.provider).toBe("openai");
  });

  it("keeps fallback disabled by default and isolated by capability", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_FALLBACK_ENABLED: "true",
      AI_QUESTION_FALLBACK_PROVIDER: "openai",
      AI_QUESTION_FALLBACK_MODEL: "gpt-fallback",
    });
    expect(resolveCapabilityConfig("QUESTION", env).fallback.effectivelyEnabled).toBe(true);
    expect(resolveCapabilityConfig("MEAL_TEXT", env).fallback.requested).toBe(false);
  });

  it("degrades only the requested capability when the fallback key is absent", () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-primary",
      AI_MEAL_TEXT_FALLBACK_ENABLED: "true",
      AI_MEAL_TEXT_FALLBACK_PROVIDER: "gemini",
      AI_MEAL_TEXT_FALLBACK_MODEL: "gemini-2.5-flash",
      AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED: "true",
    });

    const mealText = resolveCapabilityConfig("MEAL_TEXT", env);
    expect(mealText.state).toBe("degraded");
    expect(mealText.fallback.effectivelyEnabled).toBe(false);
    expect(mealText.diagnostics.some(item => item.includes("fallback provider=gemini missing required secret"))).toBe(true);

    const question = resolveCapabilityConfig("QUESTION", env);
    expect(question.state).toBe("ready");
    expect(question.fallback.requested).toBe(false);
  });

  it("rejects cross-provider fallback without explicit opt-in", () => {
    const resolved = resolveCapabilityConfig("QUESTION", envWith({
      OPENAI_API_KEY: "sk-test",
      GEMINI_API_KEY: "g-test",
      AI_QUESTION_FALLBACK_ENABLED: "true",
      AI_QUESTION_FALLBACK_PROVIDER: "gemini",
    }));
    expect(resolved.state).toBe("degraded");
    expect(resolved.fallback.effectivelyEnabled).toBe(false);
  });

  it("uses the fallback provider default instead of leaking the primary model", () => {
    const resolved = resolveCapabilityConfig("MEAL_TEXT", envWith({
      OPENAI_API_KEY: "sk-test",
      GEMINI_API_KEY: "g-test",
      OPENAI_MODEL: "gpt-primary-custom",
      GEMINI_MODEL: "gemini-fallback-custom",
      AI_MEAL_TEXT_FALLBACK_ENABLED: "true",
      AI_MEAL_TEXT_FALLBACK_PROVIDER: "gemini",
      AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED: "true",
    }));
    expect(resolved.fallback.effectivelyEnabled).toBe(true);
    expect(resolved.fallback.model).toBe("gemini-fallback-custom");
    expect(resolved.fallback.model).not.toBe("gpt-primary-custom");
  });

  it("reports disabled when the primary secret is absent", () => {
    const resolved = resolveCapabilityConfig("QUESTION", envWith({}));
    expect(resolved.state).toBe("disabled");
  });

  it("automatically applies fail-closed compatible endpoint policy for OPENAI_BASE_URL", () => {
    const resolved = resolveCapabilityConfig("QUESTION", envWith({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://compatible.example/v1",
    }));
    expect(resolved.primary?.provider).toBe("openai-compatible");
    expect(resolved.state).toBe("invalid");
    expect(resolved.diagnostics.some((item) => item.includes("operation allowlist"))).toBe(true);
  });

  it("allows a compatible endpoint only after all required operations are explicitly validated", () => {
    const resolved = resolveCapabilityConfig("NUTRITION_SEARCH", envWith({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "https://compatible.example/v1",
      AI_OPENAI_COMPATIBLE_OPERATIONS: "text,structured_output,web_search",
    }));
    expect(resolved.primary?.provider).toBe("openai-compatible");
    expect(resolved.state).toBe("ready");
  });

  it("does not treat Gemini as embedding-ready without an adapter method", () => {
    const resolved = resolveCapabilityConfig("EMBEDDING", envWith({
      GEMINI_API_KEY: "g-test",
      AI_EMBEDDING_PROVIDER: "gemini",
      AI_EMBEDDING_MODEL: "text-embedding-004",
    }));
    expect(resolved.state).toBe("invalid");
    expect(resolved.diagnostics.some((item) => item.includes("embeddings"))).toBe(true);
  });

  it("rejects an adapter that lacks any required operation", () => {
    const resolved = resolveCapabilityConfig("NUTRITION_SEARCH", envWith({
      GEMINI_API_KEY: "g-test",
      AI_NUTRITION_SEARCH_PROVIDER: "gemini",
      AI_NUTRITION_SEARCH_MODEL: "gemini-2.5-flash",
    }));
    expect(resolved.state).toBe("invalid");
    expect(resolved.diagnostics.some((item) => item.includes("web_search"))).toBe(true);
  });

  it("marks invalid timeout and attempts as invalid configuration", () => {
    const resolved = resolveCapabilityConfig("QUESTION", envWith({
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_TIMEOUT_MS: "zero",
      AI_QUESTION_MAX_ATTEMPTS: "-1",
    }));
    expect(resolved.state).toBe("invalid");
    expect(resolved.timeoutMs).toBeGreaterThan(0);
    expect(resolved.maxAttempts).toBeGreaterThan(0);
  });

  it("never exposes secret values in diagnostics", () => {
    const secret = "sk-super-secret-value";
    const serialized = JSON.stringify(resolveCapabilityConfig("QUESTION", envWith({
      OPENAI_API_KEY: secret,
    })));
    expect(serialized).not.toContain(secret);
  });
});
