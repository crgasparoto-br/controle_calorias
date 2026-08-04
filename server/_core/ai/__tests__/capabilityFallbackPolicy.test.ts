import { describe, expect, it, vi } from "vitest";
import { resolveCapabilityConfig } from "../configResolver";
import { AiOperationalError, executeWithPolicy } from "../policyExecutor";

/**
 * Explicit, per-capability coverage of the fallback/cross-provider policy for
 * the three capabilities migrated in #923 (QUESTION, NUTRITION_SEARCH,
 * EMBEDDING). `crossProviderFallbackIntegration.test.ts` and
 * `configResolver.test.ts` already cover this contract generically (and for
 * MEAL_TEXT/MEAL_VISION/WHATSAPP_INTENT); this file closes the gap for the
 * three newly migrated capabilities specifically, so a regression that only
 * affects one of them cannot hide behind a passing MEAL_TEXT test.
 */

function envWith(vars: Record<string, string>): NodeJS.ProcessEnv {
  return { ...vars } as unknown as NodeJS.ProcessEnv;
}

const CAPABILITIES = ["QUESTION", "NUTRITION_SEARCH", "EMBEDDING"] as const;

/** Minimal env that makes each capability's primary provider "ready" without any fallback configured. */
function baseEnvFor(capability: (typeof CAPABILITIES)[number]): Record<string, string> {
  if (capability === "EMBEDDING") {
    return { OPENAI_API_KEY: "sk-primary", AI_EMBEDDING_PROVIDER: "openai" };
  }
  return { OPENAI_API_KEY: "sk-primary", [`AI_${capability}_PROVIDER`]: "openai" };
}

describe("per-capability fallback policy (QUESTION, NUTRITION_SEARCH, EMBEDDING)", () => {
  describe("1. fallback disabled by default without an explicit *_FALLBACK_ENABLED flag", () => {
    it.each(CAPABILITIES)("%s: does not call a second provider absent AI_<CAPABILITY>_FALLBACK_ENABLED", async (capability) => {
      const env = envWith({
        ...baseEnvFor(capability),
        GEMINI_API_KEY: "g-fallback",
        // Note: no AI_<CAPABILITY>_FALLBACK_ENABLED set.
        [`AI_${capability}_FALLBACK_PROVIDER`]: "gemini",
      });

      const resolved = resolveCapabilityConfig(capability, env);
      expect(resolved.fallback.requested).toBe(false);
      expect(resolved.fallback.effectivelyEnabled).toBe(false);

      const primary = vi.fn(async () => {
        throw new AiOperationalError("primary temporarily unavailable");
      });
      const secondProviderCall = vi.fn(async () => "should-never-run");

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

      expect(secondProviderCall).not.toHaveBeenCalled();
    });
  });

  describe("2. enabling fallback on one capability does not leak into the others", () => {
    it("enabling QUESTION fallback leaves NUTRITION_SEARCH and EMBEDDING untouched", () => {
      const env = envWith({
        OPENAI_API_KEY: "sk-primary",
        GEMINI_API_KEY: "g-fallback",
        AI_QUESTION_PROVIDER: "openai",
        AI_QUESTION_FALLBACK_ENABLED: "true",
        AI_QUESTION_FALLBACK_PROVIDER: "openai",
        AI_QUESTION_FALLBACK_MODEL: "gpt-4.1-mini",
      });

      expect(resolveCapabilityConfig("QUESTION", env).fallback.effectivelyEnabled).toBe(true);
      expect(resolveCapabilityConfig("NUTRITION_SEARCH", env).fallback.requested).toBe(false);
      expect(resolveCapabilityConfig("NUTRITION_SEARCH", env).fallback.effectivelyEnabled).toBe(false);
      expect(resolveCapabilityConfig("EMBEDDING", env).fallback.requested).toBe(false);
      expect(resolveCapabilityConfig("EMBEDDING", env).fallback.effectivelyEnabled).toBe(false);
    });

    it("enabling NUTRITION_SEARCH fallback leaves QUESTION and EMBEDDING untouched", () => {
      const env = envWith({
        OPENAI_API_KEY: "sk-primary",
        AI_NUTRITION_SEARCH_PROVIDER: "openai",
        AI_NUTRITION_SEARCH_FALLBACK_ENABLED: "true",
        AI_NUTRITION_SEARCH_FALLBACK_PROVIDER: "openai",
        AI_NUTRITION_SEARCH_FALLBACK_MODEL: "gpt-4.1-mini",
      });

      expect(resolveCapabilityConfig("NUTRITION_SEARCH", env).fallback.effectivelyEnabled).toBe(true);
      expect(resolveCapabilityConfig("QUESTION", env).fallback.requested).toBe(false);
      expect(resolveCapabilityConfig("EMBEDDING", env).fallback.requested).toBe(false);
    });

    it("enabling EMBEDDING fallback leaves QUESTION and NUTRITION_SEARCH untouched", () => {
      const env = envWith({
        OPENAI_API_KEY: "sk-primary",
        AI_EMBEDDING_PROVIDER: "openai",
        AI_EMBEDDING_FALLBACK_ENABLED: "true",
        AI_EMBEDDING_FALLBACK_PROVIDER: "openai",
        AI_EMBEDDING_FALLBACK_MODEL: "text-embedding-3-small",
      });

      expect(resolveCapabilityConfig("EMBEDDING", env).fallback.effectivelyEnabled).toBe(true);
      expect(resolveCapabilityConfig("QUESTION", env).fallback.requested).toBe(false);
      expect(resolveCapabilityConfig("NUTRITION_SEARCH", env).fallback.requested).toBe(false);
    });
  });

  describe("3. cross-provider fallback refused without explicit opt-in, and fail-closed in production", () => {
    it.each(["QUESTION", "NUTRITION_SEARCH"] as const)(
      "%s: cross-provider fallback stays disabled without AI_<CAPABILITY>_CROSS_PROVIDER_FALLBACK_ENABLED",
      (capability) => {
        const resolved = resolveCapabilityConfig(capability, envWith({
          OPENAI_API_KEY: "sk-primary",
          GEMINI_API_KEY: "g-fallback",
          [`AI_${capability}_PROVIDER`]: "openai",
          [`AI_${capability}_FALLBACK_ENABLED`]: "true",
          [`AI_${capability}_FALLBACK_PROVIDER`]: "gemini",
        }));

        expect(resolved.fallback.requested).toBe(true);
        expect(resolved.fallback.crossProviderEnabled).toBe(false);
        expect(resolved.fallback.effectivelyEnabled).toBe(false);
      },
    );

    it.each(["QUESTION", "NUTRITION_SEARCH"] as const)(
      "AI-CROSS-PROVIDER-PROD-001: %s keeps cross-provider fallback fail-closed in production even with explicit opt-in",
      (capability) => {
        const prefix = `AI_${capability}`;
        const resolved = resolveCapabilityConfig(capability, envWith({
          NODE_ENV: "production",
          OPENAI_API_KEY: "sk-primary",
          GEMINI_API_KEY: "g-fallback",
          [`${prefix}_PROVIDER`]: "openai",
          [`${prefix}_FALLBACK_ENABLED`]: "true",
          [`${prefix}_FALLBACK_PROVIDER`]: "gemini",
          [`${prefix}_FALLBACK_MODEL`]: "gemini-2.5-flash",
          [`${prefix}_CROSS_PROVIDER_FALLBACK_ENABLED`]: "true",
        }));

        expect(resolved.fallback.requested).toBe(true);
        expect(resolved.fallback.crossProviderEnabled).toBe(true);
        expect(resolved.fallback.effectivelyEnabled).toBe(false);
        expect(
          resolved.diagnostics.some((item) =>
            item.includes("cross-provider fallback remains disabled in production"),
          ),
        ).toBe(true);

        const primary = vi.fn(async () => {
          throw new AiOperationalError("primary down");
        });
        const secondProviderCall = vi.fn(async () => "must-not-run");

        return expect(
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
        ).rejects.toThrow("primary down").then(() => {
          expect(secondProviderCall).not.toHaveBeenCalled();
        });
      },
    );

    it("EMBEDDING: cross-provider fallback is naturally unavailable because Gemini does not support the `embeddings` operation, with no manual opt-in needed", () => {
      const resolved = resolveCapabilityConfig("EMBEDDING", envWith({
        OPENAI_API_KEY: "sk-primary",
        GEMINI_API_KEY: "g-fallback",
        AI_EMBEDDING_PROVIDER: "openai",
        AI_EMBEDDING_FALLBACK_ENABLED: "true",
        AI_EMBEDDING_FALLBACK_PROVIDER: "gemini",
        AI_EMBEDDING_CROSS_PROVIDER_FALLBACK_ENABLED: "true",
      }));

      // Even with the operator opting into cross-provider fallback, Gemini is
      // rejected as a fallback target because it does not implement `embeddings`
      // in the support matrix (GEMINI_OPERATIONS in supportMatrix.ts).
      expect(resolved.fallback.requested).toBe(true);
      expect(resolved.fallback.effectivelyEnabled).toBe(false);
      expect(
        resolved.diagnostics.some((item) => item.toLowerCase().includes("embeddings")),
      ).toBe(true);
    });
  });

  describe("4. at most one fallback call after the primary is exhausted (no parallelism, no chain)", () => {
    it.each(CAPABILITIES)("%s: calls the fallback exactly once, only after the primary exhausts its attempts", async (capability) => {
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
          state: "ready",
          maxAttempts: 2,
          timeoutMs: 5000,
          fallback: { effectivelyEnabled: true },
        },
        primary,
        secondProviderCall,
      );

      expect(result.source).toBe("fallback");
      expect(primary).toHaveBeenCalledTimes(2);
      expect(secondProviderCall).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(["primary", "primary", "fallback"]);
      // capability is only used to parametrize the assertion — the executor itself is capability-agnostic.
      expect(CAPABILITIES).toContain(capability);
    });
  });

  describe("5. invalid configuration/authentication/incompatibility never triggers external fallback", () => {
    it("QUESTION: missing primary secret (disabled) never requests fallback", () => {
      const resolved = resolveCapabilityConfig("QUESTION", envWith({}));
      expect(resolved.state).toBe("disabled");
      expect(resolved.fallback.effectivelyEnabled).toBe(false);
    });

    it("NUTRITION_SEARCH: invalid timeout/attempts configuration never requests fallback", () => {
      const resolved = resolveCapabilityConfig("NUTRITION_SEARCH", envWith({
        OPENAI_API_KEY: "sk-test",
        AI_NUTRITION_SEARCH_TIMEOUT_MS: "not-a-number",
        AI_NUTRITION_SEARCH_MAX_ATTEMPTS: "-1",
      }));
      expect(resolved.state).toBe("invalid");
      expect(resolved.fallback.effectivelyEnabled).toBe(false);
    });

    it("EMBEDDING: Gemini primary without embeddings support is invalid and never requests fallback", () => {
      const resolved = resolveCapabilityConfig("EMBEDDING", envWith({
        GEMINI_API_KEY: "g-test",
        AI_EMBEDDING_PROVIDER: "gemini",
        AI_EMBEDDING_MODEL: "text-embedding-004",
      }));
      expect(resolved.state).toBe("invalid");
      expect(resolved.fallback.effectivelyEnabled).toBe(false);
    });

    it("EMBEDDING: an operational failure classified as non-retryable (e.g. authentication) never reaches the fallback provider", async () => {
      const primary = vi.fn(async () => {
        throw new (await import("../policyExecutor")).AiNonRetryableError(
          "Invalid API key",
          undefined,
          "authentication",
        );
      });
      const secondProviderCall = vi.fn(async () => "must-not-run");

      await expect(
        executeWithPolicy(
          {
            state: "ready",
            maxAttempts: 3,
            timeoutMs: 5000,
            fallback: { effectivelyEnabled: true },
          },
          primary,
          secondProviderCall,
        ),
      ).rejects.toThrow("Invalid API key");

      expect(primary).toHaveBeenCalledTimes(1);
      expect(secondProviderCall).not.toHaveBeenCalled();
    });
  });
});
