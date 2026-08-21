import { afterEach, describe, expect, it, vi } from "vitest";
import type { WhatsappIntentContext } from "./intentContext";

const { interpretMock, logInferenceEventMock } = vi.hoisted(() => ({
  interpretMock: vi.fn(),
  logInferenceEventMock: vi.fn(),
}));

vi.mock("./intentInterpreter", () => ({
  interpretWhatsappMessageWithDiagnostics: interpretMock,
}));
vi.mock("../../db", () => ({
  logInferenceEvent: logInferenceEventMock,
}));

const { compareWhatsappIntentInShadow, isShadowIntentComparisonEnabled } = await import("./shadowIntentComparison");
const originalEnv = { ...process.env };

function context(source: "legacy" | "persistent"): WhatsappIntentContext {
  return {
    version: "whatsapp-intent-context/v2",
    nowIso: "2026-07-11T12:00:00.000Z",
    timezone: "America/Sao_Paulo",
    mealAliases: {},
    currentDomainSnapshot: { latestMeal: null, mealsToday: [], recentFoodNames: [] },
    contextualMemories: [] as never,
    pendingClarification: null,
    recentTurns: [],
    conversationSummary: null,
    conversationActive: true,
    truncated: false,
    contextRead: {
      mode: "shadow",
      flow: "text",
      source,
      persistentEligible: true,
      equivalent: false,
      legacyCount: 1,
      persistentCount: 1,
    },
  };
}

function interpretation(targetFood: string, requiresConfirmation = false) {
  return {
    intent: {
      intent: "edit_food_quantity",
      confidence: 0.9,
      date: null,
      meal: null,
      items: [],
      sourceFood: null,
      targetFood,
      quantity: { value: 50, unit: "g" },
      requiresConfirmation,
      clarificationQuestion: null,
      possibleIntents: [],
      reason: null,
    },
    source: "llm",
    validationStatus: "valid",
    operationalTrace: { strategy: "llm_structured", durationMs: 1, estimatedCostUnits: 1 },
  };
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.clearAllMocks();
});

describe("shadowIntentComparison", () => {
  it("é desativado por padrão e exige opt-in explícito", () => {
    delete process.env.WHATSAPP_CONTEXT_SHADOW_COMPARE_INTENT;
    expect(isShadowIntentComparisonEnabled()).toBe(false);
    process.env.WHATSAPP_CONTEXT_SHADOW_COMPARE_INTENT = "true";
    expect(isShadowIntentComparisonEnabled()).toBe(true);
  });

  it("registra divergência de alvo sem conteúdo alimentar ou fingerprint", async () => {
    interpretMock
      .mockResolvedValueOnce(interpretation("Chocolate ao leite"))
      .mockResolvedValueOnce(interpretation("Chocolate amargo"));

    await compareWhatsappIntentInShadow({
      userId: 7,
      text: "o segundo",
      flow: "text",
      legacyContext: context("legacy"),
      persistentContext: context("persistent"),
    });

    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.history.shadow_intent_divergence",
      status: "warning",
    }));
    const detail = logInferenceEventMock.mock.calls[0][0].detail as string;
    expect(JSON.parse(detail)).toEqual(expect.objectContaining({
      sameIntent: true,
      sameTarget: false,
      sameConfirmation: true,
    }));
    expect(detail).not.toMatch(/Chocolate|chocolate|targetHash|[a-f0-9]{32,}/);
  });

  it("registra equivalência quando intenção, alvo e confirmação coincidem", async () => {
    interpretMock
      .mockResolvedValueOnce(interpretation("Arroz branco"))
      .mockResolvedValueOnce(interpretation("arroz branco"));

    await compareWhatsappIntentInShadow({
      userId: 7,
      text: "diminuir para 50g",
      flow: "text",
      legacyContext: context("legacy"),
      persistentContext: context("persistent"),
    });

    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.history.shadow_intent_equivalent",
      status: "success",
    }));
  });
});
