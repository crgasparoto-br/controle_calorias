import { describe, expect, it } from "vitest";
import { resolveCapabilityConfig } from "../configResolver";
import { getSupportedOperations } from "../supportMatrix";

function envWith(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { ...vars } as NodeJS.ProcessEnv;
}

describe("OpenAI-compatible endpoint contract", () => {
  it("keeps the compatible adapter unsupported when OPENAI_BASE_URL is absent", () => {
    const env = envWith({
      AI_OPENAI_COMPATIBLE_OPERATIONS: "text,web_search",
    });
    expect(getSupportedOperations("openai-compatible", env)).toEqual([]);
  });

  it("marks an explicitly selected compatible provider invalid without an endpoint", () => {
    const resolved = resolveCapabilityConfig("QUESTION", envWith({
      OPENAI_API_KEY: "sk-test",
      AI_QUESTION_PROVIDER: "openai-compatible",
      AI_QUESTION_MODEL: "vendor/model-v9",
      AI_OPENAI_COMPATIBLE_OPERATIONS: "text,web_search",
    }));

    expect(resolved.primary?.provider).toBe("openai-compatible");
    expect(resolved.state).toBe("invalid");
    expect(resolved.diagnostics.some(item => item.includes("does not support required operation"))).toBe(true);
  });

  it("marks a compatible fallback ineligible without an endpoint", () => {
    const resolved = resolveCapabilityConfig("QUESTION", envWith({
      OPENAI_API_KEY: "sk-test",
      GEMINI_API_KEY: "g-test",
      AI_QUESTION_PROVIDER: "openai",
      AI_QUESTION_FALLBACK_ENABLED: "true",
      AI_QUESTION_FALLBACK_PROVIDER: "openai-compatible",
      AI_QUESTION_FALLBACK_MODEL: "vendor/model-v9",
      AI_QUESTION_CROSS_PROVIDER_FALLBACK_ENABLED: "true",
      AI_OPENAI_COMPATIBLE_OPERATIONS: "text,web_search",
    }));

    expect(resolved.fallback.effectivelyEnabled).toBe(false);
    expect(resolved.state).toBe("degraded");
  });
});
