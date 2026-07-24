import { describe, expect, it, vi } from "vitest";

import { MealInferenceError } from "../../nutritionEngine";
import { createConfirmedMealRegistrationService } from "./confirmedMealRegistration";
import { executeWhatsappLlmIntent } from "./llmIntentActions";
import {
  createWhatsappMealIntentDecisionInteraction,
  MEAL_INTENT_DECISION_INTERACTION_ID,
} from "./mealIntentDecisionInteraction";
import { createWhatsappMealIntentRegistrationDetailsInteraction } from "./mealIntentRegistrationDetailsInteraction";
import { resolveWhatsAppPrecedenceGate } from "./messageRouter";

function processed(text: string) {
  return {
    detectedMealLabel: "Café da manhã",
    sourceText: text,
    transcript: null,
    reasoning: "fixture",
    confidence: 0.98,
    needsConfirmation: false,
    items: [{
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      portionText: "200 ml",
      quantity: 200,
      unit: "ml",
      estimatedGrams: 200,
      calories: 40,
      protein: 0,
      carbs: 10,
      fat: 0,
      fiber: 0,
      source: "manual",
    }],
    totals: { calories: 40, protein: 0, carbs: 10, fat: 0, fiber: 0 },
  } as any;
}

function savedMeal() {
  return {
    id: 89901,
    userId: 899,
    mealLabel: "Café da manhã",
    occurredAt: new Date("2026-07-24T10:00:00.000Z"),
    notes: "200 ml café com açúcar",
    items: processed("200 ml café com açúcar").items,
  } as any;
}

describe("issue #899 orchestration regressions", () => {
  it("persiste 200 ml café com açúcar pelo pipeline canônico após confirmação", async () => {
    const confirmMeal = vi.fn(async () => savedMeal());
    const service = createConfirmedMealRegistrationService({
      processMeal: vi.fn(async input => processed(input.text ?? "")),
      getHabits: vi.fn(async () => []),
      createDraft: vi.fn(() => ({ draftId: "draft-899" } as any)),
      confirmMeal: confirmMeal as any,
      consolidateMeal: vi.fn(async (_deps, meal) => ({ action: "created", meal })) as any,
      getGoalProgress: vi.fn(async () => undefined) as any,
    });

    const result = await service({
      userId: 899,
      registrationText: "200 ml café com açúcar",
      originalText: "200 ml café com açúcar",
      occurredAt: new Date("2026-07-24T10:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.status).toBe("registered");
    expect(confirmMeal).toHaveBeenCalledTimes(1);
    if (result.status !== "registered") throw new Error("unreachable");
    expect(result.result.action).toBe("meal_item_added");
    expect(result.result.data).toEqual(expect.objectContaining({ mealId: 89901 }));
  });

  it("distingue falta de dado antes da mutação de falha após mutação possível", async () => {
    const detailsService = createConfirmedMealRegistrationService({
      processMeal: vi.fn(async () => {
        throw new MealInferenceError("Qual foi a quantidade de açúcar?");
      }),
      getHabits: vi.fn(async () => []),
    });
    const details = await detailsService({
      userId: 899,
      registrationText: "café com açúcar",
      originalText: "café com açúcar",
      occurredAt: new Date(),
      userTimezone: "America/Sao_Paulo",
    });
    expect(details).toEqual(expect.objectContaining({
      status: "details_needed",
      prompt: "Qual foi a quantidade de açúcar?",
    }));

    const blockedService = createConfirmedMealRegistrationService({
      processMeal: vi.fn(async () => processed("200 ml café com açúcar")),
      getHabits: vi.fn(async () => []),
      createDraft: vi.fn(() => ({ draftId: "draft-899" } as any)),
      confirmMeal: vi.fn(async () => {
        throw new Error("connection lost after write");
      }) as any,
    });
    const blocked = await blockedService({
      userId: 899,
      registrationText: "200 ml café com açúcar",
      originalText: "200 ml café com açúcar",
      occurredAt: new Date(),
      userTimezone: "America/Sao_Paulo",
    });
    expect(blocked.status).toBe("blocked_after_possible_mutation");
  });

  it("faz o produtor LLM delegar à mesma pendência persistente", async () => {
    const previous = process.env.OPENAI_WHATSAPP_INTENT_ENABLED;
    process.env.OPENAI_WHATSAPP_INTENT_ENABLED = "false";
    try {
      const result = await executeWhatsappLlmIntent(899200, {
        text: "jantar com arroz e feijão",
        receivedAt: new Date("2026-07-24T20:00:00.000Z"),
        userTimezone: "America/Sao_Paulo",
      });
      expect(result && "handled" in result ? result.eventType : null).toBe(
        "whatsapp.meal_intent_decision.requested",
      );
      expect(result && "handled" in result ? result.data : null).toEqual(
        expect.objectContaining({ interactionId: MEAL_INTENT_DECISION_INTERACTION_ID }),
      );
    } finally {
      if (previous === undefined) delete process.env.OPENAI_WHATSAPP_INTENT_ENABLED;
      else process.env.OPENAI_WHATSAPP_INTENT_ENABLED = previous;
    }
  });

  it("bloqueia alias textual de decisão expirada antes do menu genérico", async () => {
    const createdAt = new Date("2026-07-24T10:00:00.000Z");
    await createWhatsappMealIntentDecisionInteraction({
      userId: 899201,
      originalText: "200 ml café com açúcar",
      receivedAt: createdAt,
    });
    const result = await resolveWhatsAppPrecedenceGate({
      userId: 899201,
      text: "Registrar",
      receivedAt: new Date(createdAt.getTime() + 11 * 60 * 1000),
      userTimezone: "America/Sao_Paulo",
    });
    expect(result.step).toBe("pending_interaction");
    if (result.step !== "pending_interaction") throw new Error("unreachable");
    expect(result.result.eventType).toBe("whatsapp.meal_intent_decision.unavailable");
    expect(result.result.reply).not.toContain("corrigir uma refeição");
  });

  it("substitui a clarificação complementar quando chega novo comando completo", async () => {
    const receivedAt = new Date("2026-07-24T10:20:00.000Z");
    await createWhatsappMealIntentRegistrationDetailsInteraction({
      userId: 899202,
      originalText: "café com açúcar",
      prompt: "Qual foi a quantidade de açúcar?",
      receivedAt,
    });

    const result = await resolveWhatsAppPrecedenceGate({
      userId: 899202,
      text: "registrar 100 g de arroz",
      receivedAt: new Date(receivedAt.getTime() + 1000),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.step).toBe("continue_pipeline");
  });
});
