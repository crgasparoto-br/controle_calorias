import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiOperationalError } from "./_core/ai/policyExecutor";

const mocks = vi.hoisted(() => ({
  logInferenceEvent: vi.fn(),
  resolveCapabilityConfig: vi.fn(),
  executeResolvedCapability: vi.fn(),
  createTextResponse: vi.fn(),
}));

vi.mock("./db", () => ({
  logInferenceEvent: mocks.logInferenceEvent,
}));
vi.mock("./_core/ai/configResolver", () => ({
  resolveCapabilityConfig: (...args: unknown[]) =>
    mocks.resolveCapabilityConfig(...args),
}));
vi.mock("./_core/ai/capabilityExecutor", () => ({
  executeResolvedCapability: (...args: unknown[]) =>
    mocks.executeResolvedCapability(...args),
}));
vi.mock("./_core/ai/domainTextResponse", () => ({
  createDomainTextResponse: (...args: unknown[]) =>
    mocks.createTextResponse(...args),
}));

const { findBrandedNutritionByWebSearch } = await import(
  "./brandedNutritionSearch"
);

const READY_POLICY = {
  capability: "NUTRITION_SEARCH" as const,
  state: "ready" as const,
  primary: { provider: "openai" as const, model: "gpt-4.1-mini" },
  fallback: {
    requested: false,
    effectivelyEnabled: false,
    provider: null,
    model: null,
    crossProviderEnabled: false,
  },
  timeoutMs: 8_000,
  maxAttempts: 1,
  diagnostics: [],
  usedLegacyVariables: false,
};

const PRODUCT = "1 fatia de pão de forma Panco Premium";
const SOURCE_URL = "https://panco.example/premium";
const NUTRITION_EVIDENCE =
  "Porção: 50 g (2 fatias). Pão de Forma Panco Premium: 127 kcal, 4 g proteínas, 24 g carboidratos e 2 g gorduras.";

function providerOutput(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    found: true,
    matchedProductName: "Pão de Forma Panco Premium",
    brandName: "Panco",
    servingLabel: "2 fatias (50 g)",
    gramsPerServing: 50,
    calories: 127,
    protein: 4,
    carbs: 24,
    fat: 2,
    confidence: 0.96,
    sourceUrl: SOURCE_URL,
    evidence: "Resumo estruturado do provider.",
    ...overrides,
  });
}

function installExecution(input: {
  outputText?: string;
  sourceText?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  executed?: boolean;
}) {
  const sourceUrl = input.sourceUrl ?? SOURCE_URL;
  mocks.createTextResponse.mockResolvedValue({
    id: "response-1072",
    outputText: input.outputText ?? providerOutput(),
    webSearch: {
      executed: input.executed ?? true,
      sources: [
        {
          url: sourceUrl,
          title: input.sourceTitle ?? "Pão de Forma Panco Premium",
          supportingText: [input.sourceText ?? NUTRITION_EVIDENCE],
        },
      ],
    },
  });
  mocks.executeResolvedCapability.mockImplementation(
    async (
      _policy: unknown,
      operation: (attempt: unknown) => Promise<unknown>,
      options?: { observability?: { correlation?: { traceId?: string } } }
    ) => {
      expect(options?.observability?.correlation?.traceId).toMatch(
        /^[0-9a-f-]{36}$/
      );
      const value = await operation({
        signal: new AbortController().signal,
        source: "primary",
        attempt: 1,
        timeoutMs: 8_000,
        provider: {
          createTextResponse: (request: unknown) =>
            mocks.createTextResponse(request),
        },
        providerId: "openai",
        model: "gpt-4.1-mini",
      });
      return { value, source: "primary", attempts: 1, usedFallback: false };
    }
  );
}

function lastDecision() {
  const event = mocks.logInferenceEvent.mock.calls.at(-1)?.[0] as
    | { detail?: string }
    | undefined;
  expect(event?.eventType).toBe("nutrition.search_decision");
  return JSON.parse(event?.detail ?? "{}");
}

describe("issue #1072 — diagnóstico seguro de NUTRITION_SEARCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveCapabilityConfig.mockReturnValue(READY_POLICY);
  });

  it("registra aceite e executa uma única chamada com correlação opaca", async () => {
    installExecution({});

    const result = await findBrandedNutritionByWebSearch(PRODUCT, {
      resolveCapabilityConfig: mocks.resolveCapabilityConfig,
      executeResolvedCapability: mocks.executeResolvedCapability,
    });

    expect(result).toEqual(
      expect.objectContaining({
        brandName: "Panco",
        gramsPerServing: 50,
        calories: 127,
      })
    );
    expect(mocks.executeResolvedCapability).toHaveBeenCalledTimes(1);
    expect(mocks.createTextResponse).toHaveBeenCalledTimes(1);
    expect(lastDecision()).toMatchObject({
      stage: "product_identity",
      reason: "accepted",
      hasStructuredCandidate: true,
      webSearchExecuted: true,
      sourceCount: 1,
      guards: {
        productIdentity: true,
        brandIdentity: true,
        variant: true,
        portion: true,
        numericGrounding: true,
        sourceGrounding: true,
      },
    });
  });

  it.each([
    ["encontrado=false", providerOutput({ found: false }), "found_false"],
    [
      "variante divergente",
      providerOutput({ matchedProductName: "Pão de Forma Panco Integral" }),
      "variant_incompatible",
    ],
    ["fonte de outra variante", providerOutput({}), "source_identity_mismatch"],
    [
      "grounding numérico ausente",
      providerOutput({}),
      "numeric_grounding_insufficient",
    ],
  ])(
    "distingue %s antes de devolver null",
    async (label, outputText, expectedReason) => {
      if (label === "fonte de outra variante") {
        installExecution({
          outputText,
          sourceText:
            "Porção: 50 g (2 fatias). Pão de Forma Panco Integral: 120 kcal, 4 g proteínas, 22 g carboidratos e 2 g gorduras.",
          sourceTitle: "Pão de Forma Panco Integral",
          sourceUrl: "https://panco.example/integral",
        });
      } else if (label === "grounding numérico ausente") {
        installExecution({
          outputText,
          sourceText:
            "Porção: 50 g (2 fatias). Pão de Forma Panco Premium. Consulte a tabela nutricional no site.",
        });
      } else {
        installExecution({ outputText });
      }

      await expect(
        findBrandedNutritionByWebSearch(PRODUCT, {
          resolveCapabilityConfig: mocks.resolveCapabilityConfig,
          executeResolvedCapability: mocks.executeResolvedCapability,
        })
      ).resolves.toBeNull();

      expect(lastDecision().reason).toBe(expectedReason);
    }
  );

  it("distingue indisponibilidade de configuração e não cria provider", async () => {
    mocks.resolveCapabilityConfig.mockReturnValue({
      ...READY_POLICY,
      state: "disabled",
      primary: null,
    });

    await expect(
      findBrandedNutritionByWebSearch(PRODUCT, {
        resolveCapabilityConfig: mocks.resolveCapabilityConfig,
        executeResolvedCapability: mocks.executeResolvedCapability,
      })
    ).resolves.toBeNull();

    expect(mocks.executeResolvedCapability).not.toHaveBeenCalled();
    expect(lastDecision()).toMatchObject({
      reason: "capability_unavailable",
      hasStructuredCandidate: false,
      webSearchExecuted: false,
      sourceCount: 0,
    });
  });

  it("distingue timeout/falha operacional do resultado semântico", async () => {
    mocks.executeResolvedCapability.mockRejectedValue(
      new AiOperationalError("provider timeout", undefined, "timeout")
    );

    await expect(
      findBrandedNutritionByWebSearch(PRODUCT, {
        resolveCapabilityConfig: mocks.resolveCapabilityConfig,
        executeResolvedCapability: mocks.executeResolvedCapability,
      })
    ).resolves.toBeNull();

    expect(lastDecision()).toMatchObject({
      reason: "execution_failed",
      operationalOutcome: "timeout",
      hasStructuredCandidate: false,
    });
  });

  it("preserva origem WhatsApp e separa marca de identidade do produto", async () => {
    installExecution({
      outputText: providerOutput({
        matchedProductName: "Pão de Forma Panco Integral",
      }),
      sourceText:
        "Porção: 50 g (2 fatias). Pão de Forma Panco Integral: 120 kcal, 4 g proteínas, 22 g carboidratos e 2 g gorduras.",
      sourceTitle: "Pão de Forma Panco Integral",
      sourceUrl: "https://panco.example/integral",
    });

    await expect(
      findBrandedNutritionByWebSearch(
        PRODUCT,
        {
          resolveCapabilityConfig: mocks.resolveCapabilityConfig,
          executeResolvedCapability: mocks.executeResolvedCapability,
        },
        {
          telemetry: {
            userId: 1072,
            origin: "whatsapp",
            traceId: "00000000-0000-4000-8000-000000001072",
          },
        },
      )
    ).resolves.toBeNull();

    const event = mocks.logInferenceEvent.mock.calls.at(-1)?.[0] as {
      origin?: string;
      userId?: number;
    };
    expect(event).toMatchObject({
      origin: "whatsapp",
      userId: 1072,
    });
    expect(lastDecision()).toMatchObject({
      traceId: "00000000-0000-4000-8000-000000001072",
      reason: "variant_incompatible",
      guards: {
        productIdentity: false,
        brandIdentity: true,
        variant: false,
      },
    });
  });

  it("não persiste nomes, consulta, URL, evidência ou erro bruto no diagnóstico", async () => {
    installExecution({
      sourceText:
        "Panco Premium 50 g: 127 kcal, 4 g proteínas, 24 g carboidratos e 2 g gorduras.",
    });

    await findBrandedNutritionByWebSearch(PRODUCT, {
      resolveCapabilityConfig: mocks.resolveCapabilityConfig,
      executeResolvedCapability: mocks.executeResolvedCapability,
    });

    const detail = lastDecision();
    expect(detail).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        traceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      })
    );
    expect(JSON.stringify(detail)).not.toMatch(
      /Panco|Premium|fatia|https?:|kcal|proteínas|evidência|provider timeout|query|sourceUrl|sourceEvidence/i
    );
    expect(Object.keys(detail).sort()).toEqual([
      "guards",
      "hasStructuredCandidate",
      "reason",
      "schemaVersion",
      "sourceCount",
      "stage",
      "traceId",
      "webSearchExecuted",
    ]);
  });
});
