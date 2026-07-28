import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../../aiProvider";
import type { ResolvedCapabilityConfig } from "../configResolver";
import {
  executeResolvedCapability,
  type ResolvedCapabilityAttemptContext,
} from "../capabilityExecutor";
import type { AiProviderFactoryMap } from "../providerResolver";
import { AiOperationalError } from "../policyExecutor";

function provider(id: string): AiProvider {
  return { id } as unknown as AiProvider;
}

function factories(): {
  map: AiProviderFactoryMap;
  openai: AiProvider;
  gemini: AiProvider;
} {
  const openai = provider("openai");
  const gemini = provider("gemini");
  return {
    openai,
    gemini,
    map: {
      openai: vi.fn(() => openai),
      "openai-compatible": vi.fn(() => openai),
      gemini: vi.fn(() => gemini),
    },
  };
}

function config(overrides: Partial<ResolvedCapabilityConfig> = {}): ResolvedCapabilityConfig {
  return {
    capability: "MEAL_TEXT",
    state: "ready",
    primary: { provider: "openai", model: "gpt-primary" },
    timeoutMs: 1000,
    maxAttempts: 1,
    fallback: {
      requested: false,
      effectivelyEnabled: false,
      provider: null,
      model: null,
      crossProviderEnabled: false,
    },
    diagnostics: [],
    usedLegacyVariables: false,
    ...overrides,
  };
}

describe("resolved capability executor", () => {
  it("binds the resolved primary provider and model to the operation", async () => {
    const adapters = factories();
    const operation = vi.fn(async ({
      provider: adapter,
      providerId,
      model,
    }: ResolvedCapabilityAttemptContext) => ({
      adapter,
      providerId,
      model,
    }));

    const result = await executeResolvedCapability(config(), operation, {
      providerFactories: adapters.map,
    });

    expect(result.value).toEqual({
      adapter: adapters.openai,
      providerId: "openai",
      model: "gpt-primary",
    });
    expect(adapters.map.openai).toHaveBeenCalledTimes(1);
    expect(adapters.map.gemini).not.toHaveBeenCalled();
  });

  it("keeps retries on the resolved primary and uses the resolved fallback once", async () => {
    const adapters = factories();
    const seen: string[] = [];
    const operation = vi.fn(async ({
      providerId,
      model,
      source,
    }: ResolvedCapabilityAttemptContext) => {
      seen.push(`${source}:${providerId}:${model}`);
      if (source === "primary") throw new AiOperationalError("primary down");
      return "fallback-ok";
    });

    const result = await executeResolvedCapability(config({
      maxAttempts: 2,
      fallback: {
        requested: true,
        effectivelyEnabled: true,
        provider: "gemini",
        model: "gemini-fallback",
        crossProviderEnabled: true,
      },
    }), operation, { providerFactories: adapters.map });

    expect(result.value).toBe("fallback-ok");
    expect(seen).toEqual([
      "primary:openai:gpt-primary",
      "primary:openai:gpt-primary",
      "fallback:gemini:gemini-fallback",
    ]);
    expect(adapters.map.openai).toHaveBeenCalledTimes(1);
    expect(adapters.map.gemini).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed resolved fallback before any adapter operation", async () => {
    const adapters = factories();
    const operation = vi.fn(async () => "must-not-run");

    await expect(executeResolvedCapability(config({
      fallback: {
        requested: true,
        effectivelyEnabled: true,
        provider: "gemini",
        model: null,
        crossProviderEnabled: true,
      },
    }), operation, { providerFactories: adapters.map })).rejects.toMatchObject({
      code: "invalid_configuration",
    });

    expect(operation).not.toHaveBeenCalled();
    expect(adapters.map.openai).not.toHaveBeenCalled();
    expect(adapters.map.gemini).not.toHaveBeenCalled();
  });

  it("does not instantiate an adapter for disabled or invalid configuration", async () => {
    const adapters = factories();
    const operation = vi.fn(async () => "must-not-run");

    await expect(executeResolvedCapability(config({ state: "disabled" }), operation, {
      providerFactories: adapters.map,
    })).rejects.toMatchObject({ code: "invalid_configuration" });

    expect(operation).not.toHaveBeenCalled();
    expect(adapters.map.openai).not.toHaveBeenCalled();
    expect(adapters.map.gemini).not.toHaveBeenCalled();
  });
});
