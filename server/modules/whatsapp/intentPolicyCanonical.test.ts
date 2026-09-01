import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WhatsappIntentContext } from "./intentContext";

const createTextResponseMock = vi.hoisted(() => vi.fn());

vi.mock("../../_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown, options?: unknown) => createTextResponseMock(request, options),
  }),
}));

import { resolveCapabilityConfig } from "../../_core/ai/configResolver";
import { interpretWhatsappMessageWithDiagnostics } from "./intentInterpreter";

const context: WhatsappIntentContext = {
  version: "whatsapp-intent-context/v1",
  nowIso: "2026-07-28T12:00:00.000Z",
  timezone: "America/Sao_Paulo",
  mealAliases: {},
  latestMeal: null,
  mealsToday: [],
  recentFoodNames: [],
  contextualMemories: [],
  pendingClarification: null,
};

const originalEnv = { ...process.env };

describe("canonical WHATSAPP_INTENT policy", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.AI_WHATSAPP_INTENT_MODEL = "gpt-whatsapp-specific";
    process.env.AI_WHATSAPP_INTENT_MAX_ATTEMPTS = "1";
    delete process.env.AI_WHATSAPP_INTENT_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("passes the canonical resolved model directly to the provider adapter", async () => {
    const resolved = resolveCapabilityConfig("WHATSAPP_INTENT");
    createTextResponseMock.mockResolvedValueOnce({
      id: "intent",
      outputText: JSON.stringify({
        intent: "list_meal_records",
        confidence: 0.91,
        date: null,
        meal: null,
        items: [],
        sourceFood: null,
        targetFood: null,
        quantity: null,
        requiresConfirmation: false,
        clarificationQuestion: null,
        possibleIntents: [],
        reason: "Consulta de registros.",
      }),
      raw: {},
    });

    const result = await interpretWhatsappMessageWithDiagnostics("registro", context);

    expect(resolved.primary).toEqual({ provider: "openai", model: "gpt-whatsapp-specific" });
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
    expect(createTextResponseMock.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: resolved.primary?.model,
    }));
    expect(result.source).toBe("llm");
    expect(result.operationalTrace.modelName).toBe(resolved.primary?.model);
  });
});
