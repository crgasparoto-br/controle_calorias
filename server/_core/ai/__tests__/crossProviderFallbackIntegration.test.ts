import { describe, expect, it, vi } from "vitest";
import { resolveCapabilityConfig } from "../configResolver";
import { AiOperationalError, executeWithPolicy } from "../policyExecutor";

function envWith(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { ...vars } as unknown as NodeJS.ProcessEnv;
}

/**
 * Ties `resolveCapabilityConfig` directly to `executeWithPolicy` — the two
 * modules are otherwise only unit-tested in isolation (resolver: does the
 * *policy* forbid the second provider; executor: does it skip a fallback
 * call when told to). This closes that gap for the specific, security-
 * relevant guarantee that a cross-provider fallback the operator did not
 * explicitly opt into never reaches a second provider's network call.
 */
describe("cross-provider fallback integration (configResolver -> policyExecutor)", () => {
  it("never calls the second provider when CROSS_PROVIDER_FALLBACK_ENABLED is not set, even after the primary exhausts retries", async () => {
    const env = envWith({
      OPENAI_API_KEY: "sk-primary",
      GEMINI_API_KEY: "g-fallback",
      AI_QUESTION_FALLBACK_ENABLED: "true",
      AI_QUESTION_FALLBACK_PROVIDER: "gemini",
      AI_QUESTION_MAX_ATTEMPTS: "2",
    });

    const resolved = resolveCapabilityConfig("QUESTION", env);
    expect(resolved.fallback.effectivelyEnabled).toBe(false);
    expect(resolved.state).toBe("degraded");

    const secondProviderCall = vi.fn(async () => "should-never-run");
    const primary = vi.fn(async () => {
      throw new AiOperationalError("primary temporarily unavailable");
    });

    await expect(
      executeWithPolicy(
        {
          state: resolved.state,
          maxAttempts: resolved.maxAttempts,
          timeoutMs: resolved.timeoutMs,
          fallback: { effectivelyEnabled: resolved.fallback.effectivelyEnabled },
        },
        primary,
        secondProviderCall,
      ),
    ).rejects.toThrow("primary temporarily unavailable");

    expect(primary).toHaveBeenCalledTimes(2);
    expect(secondProviderCall).not.toHaveBeenCalled();
  });

  it("AI-CROSS-PROVIDER-PROD-001: never calls the second provider in production even when cross-provider opt-in is true", async () => {
    const env = envWith({
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-primary",
      GEMINI_API_KEY: "g-fallback",
      AI_MEAL_TEXT_PROVIDER: "openai",
      AI_MEAL_TEXT_FALLBACK_ENABLED: "true",
      AI_MEAL_TEXT_FALLBACK_PROVIDER: "gemini",
      AI_MEAL_TEXT_FALLBACK_MODEL: "gemini-2.5-flash",
      AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED: "true",
      AI_MEAL_TEXT_MAX_ATTEMPTS: "1",
    });

    const resolved = resolveCapabilityConfig("MEAL_TEXT", env);
    expect(resolved.state).toBe("degraded");
    expect(resolved.fallback.crossProviderEnabled).toBe(true);
    expect(resolved.fallback.effectivelyEnabled).toBe(false);

    const primary = vi.fn(async () => {
      throw new AiOperationalError("primary down");
    });
    const secondProviderCall = vi.fn(async () => "must-not-run");

    await expect(
      executeWithPolicy(
        {
          state: resolved.state,
          maxAttempts: resolved.maxAttempts,
          timeoutMs: resolved.timeoutMs,
          fallback: { effectivelyEnabled: resolved.fallback.effectivelyEnabled },
        },
        primary,
        secondProviderCall,
      ),
    ).rejects.toThrow("primary down");

    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondProviderCall).not.toHaveBeenCalled();
  });

  it("does call the second provider once outside production, only after the primary is exhausted, when cross-provider fallback is explicitly enabled", async () => {
    const env = envWith({
      NODE_ENV: "test",
      OPENAI_API_KEY: "sk-primary",
      GEMINI_API_KEY: "g-fallback",
      AI_MEAL_TEXT_FALLBACK_ENABLED: "true",
      AI_MEAL_TEXT_FALLBACK_PROVIDER: "gemini",
      AI_MEAL_TEXT_FALLBACK_MODEL: "gemini-2.5-flash",
      AI_MEAL_TEXT_CROSS_PROVIDER_FALLBACK_ENABLED: "true",
      AI_MEAL_TEXT_MAX_ATTEMPTS: "1",
    });

    const resolved = resolveCapabilityConfig("MEAL_TEXT", env);
    expect(resolved.state).toBe("ready");
    expect(resolved.fallback.effectivelyEnabled).toBe(true);
    expect(resolved.fallback.provider).toBe("gemini");

    const callOrder: string[] = [];
    const primary = vi.fn(async () => {
      callOrder.push("primary");
      throw new AiOperationalError("primary down");
    });
    const secondProviderCall = vi.fn(async () => {
      callOrder.push("fallback");
      return "fallback-result";
    });

    const result = await executeWithPolicy(
      {
        state: resolved.state,
        maxAttempts: resolved.maxAttempts,
        timeoutMs: resolved.timeoutMs,
        fallback: { effectivelyEnabled: resolved.fallback.effectivelyEnabled },
      },
      primary,
      secondProviderCall,
    );

    expect(result.source).toBe("fallback");
    expect(callOrder).toEqual(["primary", "fallback"]);
    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondProviderCall).toHaveBeenCalledTimes(1);
  });
});
