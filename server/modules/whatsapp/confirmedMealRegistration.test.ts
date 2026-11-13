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
  it("#1308 rejects selected V2 text before WhatsApp V1 processing", async () => {
    const oldGlobal = process.env.FOOD_V2_D1_ENABLED;
    const oldSelector = process.env.FOOD_V2_D1_ENTRYPOINTS;
    const preflight = vi.fn();
    const processMeal = vi.fn();
    try {
      process.env.FOOD_V2_D1_ENABLED = "true";
      process.env.FOOD_V2_D1_ENTRYPOINTS = "text";
      const service = createConfirmedMealRegistrationService({
        prepareCountableFoodRegistration: preflight as any,
        processMeal: processMeal as any,
      });
      await expect(service({
        userId: 899, registrationText: "100 g de arroz", originalText: "100 g de arroz",
        occurredAt: new Date("2026-07-24T10:00:00.000Z"),
        userTimezone: "America/Sao_Paulo",
      })).rejects.toThrow("food-d1-public-entrypoint-migration-incomplete");
      expect(preflight).not.toHaveBeenCalled();
      expect(processMeal).not.toHaveBeenCalled();
    } finally {
      if (oldGlobal === undefined) delete process.env.FOOD_V2_D1_ENABLED;
      else process.env.FOOD_V2_D1_ENABLED = oldGlobal;
      if (oldSelector === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
      else process.env.FOOD_V2_D1_ENTRYPOINTS = oldSelector;
    }
  });

  it("#1308 preserves already-owned V1 clarification after the V2 selection changes", async () => {
    const flag = process.env.FOOD_V2_D1_ENABLED;
    const selected = process.env.FOOD_V2_D1_ENTRYPOINTS;
    const prepare = vi.fn();
    const processMeal = vi.fn(async input => processed(input.text ?? ""));
    const createDraft = vi.fn(() => ({ draftId: "legacy-pending-d1-1308" } as any));
    const confirmMeal = vi.fn(async () => savedMeal());
    try {
      process.env.FOOD_V2_D1_ENABLED = "true";
      process.env.FOOD_V2_D1_ENTRYPOINTS = "text,audio_transcript";
      const service = createConfirmedMealRegistrationService({
        processMeal: processMeal as any, getHabits: vi.fn(async () => []),
        prepareCountableFoodRegistration: prepare as any, createDraft,
        confirmMeal: confirmMeal as any,
        consolidateMeal: vi.fn(async (_deps, meal) => ({ action: "created", meal })) as any,
        getGoalProgress: vi.fn(async () => undefined) as any,
      });
      const result = await service({
        userId: 899, registrationText: "200 ml café com açúcar",
        originalText: "200 ml café com açúcar",
        occurredAt: new Date("2026-07-24T10:00:00.000Z"),
        userTimezone: "America/Sao_Paulo",
        skipCountablePreflight: true,
      });
      expect(result.status).toBe("registered");
      expect(processMeal).toHaveBeenCalledOnce();
      expect(confirmMeal).toHaveBeenCalledOnce();
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      if (flag === undefined) delete process.env.FOOD_V2_D1_ENABLED;
      else process.env.FOOD_V2_D1_ENABLED = flag;
      if (selected === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
      else process.env.FOOD_V2_D1_ENTRYPOINTS = selected;
    }
  });

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

  it("usa o gate contável assíncrono antes de solicitar peso", async () => {
    const prepareCountableFoodRegistration = vi.fn(async () => ({
      kind: "clarification" as const,
      result: {
        handled: true,
        action: "clarification_needed",
        reply: "Informe o peso do item.",
        eventType: "whatsapp.food_clarification.requested",
        detail: "fixture",
        data: {},
      } as any,
    }));
    const processMeal = vi.fn(async (input: { text?: string | null }) => processed(input.text ?? ""));
    const createDraft = vi.fn(() => ({ draftId: "must-not-be-created" } as any));
    const service = createConfirmedMealRegistrationService({
      prepareCountableFoodRegistration,
      processMeal,
      getHabits: vi.fn(async () => []),
      createDraft,
    });

    const receivedAt = new Date("2026-11-05T12:00:00.000Z");
    const result = await service({
      userId: 899,
      registrationText: "2 fatias de pão de forma Panco",
      originalText: "2 fatias de pão de forma Panco",
      occurredAt: receivedAt,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.status).toBe("clarification_requested");
    expect(prepareCountableFoodRegistration).toHaveBeenCalledWith(expect.objectContaining({
      userId: 899,
      text: "2 fatias de pão de forma Panco",
      originalText: "2 fatias de pão de forma Panco",
      userTimezone: "America/Sao_Paulo",
      receivedAt,
    }));
    expect(processMeal).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("distingue falta de dado, falha recuperável e falha após mutação possível", async () => {
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

    const retryableService = createConfirmedMealRegistrationService({
      processMeal: vi.fn(async () => {
        throw new Error("temporary provider timeout");
      }),
      getHabits: vi.fn(async () => []),
    });
    const retryable = await retryableService({
      userId: 899,
      registrationText: "200 ml café com açúcar",
      originalText: "200 ml café com açúcar",
      occurredAt: new Date(),
      userTimezone: "America/Sao_Paulo",
    });
    expect(retryable).toEqual(expect.objectContaining({
      status: "safe_to_retry",
      prompt: expect.stringContaining("continua guardada"),
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

describe("issue #997 initial partial countable registration", () => {
  it("persists only safe items and explicitly lists the omitted item in the reply", async () => {
    const safeItem = {
      foodName: "Banana nanica",
      canonicalName: "Banana nanica",
      portionText: "80 g",
      servings: 1,
      estimatedGrams: 80,
      calories: 71,
      protein: 0.9,
      carbs: 18.3,
      fat: 0.2,
      fiber: 2.6,
      confidence: 0.9,
      source: "catalog" as const,
    };
    const skippedItems = [{
      segmentIndex: 1,
      segment: "2 ovos cozidos",
      foodName: "ovos cozidos",
      count: 2,
      requestedUnit: "un",
    }];
    const prepareCountableFoodRegistration = vi.fn(async () => ({
      kind: "ready" as const,
      registrationText: "80 g de banana nanica",
      resolutions: [],
      skippedItems,
    }));
    const confirmMeal = vi.fn(async ({ items }: { items: unknown[] }) => ({
      ...savedMeal(),
      items,
    } as any));
    const requestPartialRegistrationClarification = vi.fn(async () => ({
      handled: true as const,
      action: "food_clarification_requested",
      reply: "Informe somente o peso dos ovos, por exemplo 100 g.",
      eventType: "whatsapp.food_clarification.requested",
      detail: "Pendência parcial persistida.",
      data: { pendingOperationId: 99701 },
    }));
    const service = createConfirmedMealRegistrationService({
      prepareCountableFoodRegistration,
      processMeal: vi.fn(async input => ({
        ...processed(input.text ?? ""),
        items: [safeItem],
        totals: { calories: 71, protein: 0.9, carbs: 18.3, fat: 0.2 },
      })) as any,
      getHabits: vi.fn(async () => []),
      createDraft: vi.fn(() => ({ draftId: "draft-997-partial" } as any)),
      confirmMeal: confirmMeal as any,
      consolidateMeal: vi.fn(async (_deps, meal) => ({
        action: "created",
        meal,
      })) as any,
      getGoalProgress: vi.fn(async () => undefined) as any,
      requestPartialRegistrationClarification,
    });

    const receivedAt = new Date("2026-11-05T12:02:00.000Z");
    const result = await service({
      userId: 997,
      registrationText: "1 banana nanica, 2 ovos cozidos",
      originalText: "1 banana nanica, 2 ovos cozidos",
      occurredAt: new Date("2026-11-05T12:00:00.000Z"),
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      inboundMessageId: "wamid.issue997.original",
    });

    expect(result.status).toBe("registered");
    expect(confirmMeal).toHaveBeenCalledWith(expect.objectContaining({
      items: [safeItem],
    }));
    if (result.status !== "registered") throw new Error("unreachable");
    expect(result.result.reply).toContain("Banana nanica");
    expect(result.result.reply).toContain("O registro ficou parcial.");
    expect(result.result.reply).toContain("2 ovos cozidos");
    expect(result.result.reply).toContain("Informe o peso ou volume correspondente.");
    expect(result.result.reply).toContain("Informe somente o peso dos ovos");
    expect(result.result.data).toEqual(expect.objectContaining({
      partialRegistration: true,
      omittedItemCount: 1,
      continuationPending: true,
      continuation: { pendingOperationId: 99701 },
    }));
    expect(requestPartialRegistrationClarification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 997,
        originalText: "1 banana nanica, 2 ovos cozidos",
        currentPendingIndex: 0,
        resolvedQuantities: [null],
        receivedAt,
        messageId: "wamid.issue997.original",
        expectedMealId: 89901,
        expectedMealLabel: "Café da manhã",
        pendingItems: [expect.objectContaining({
          segment: "2 ovos cozidos",
          foodName: "ovos cozidos",
          count: 2,
        })],
      }),
    );
  });

  it("não promete continuação persistente se a pergunta não puder ser salva", async () => {
    const skippedItems = [{
      segmentIndex: 1,
      segment: "2 ovos cozidos",
      foodName: "ovos cozidos",
      count: 2,
      requestedUnit: "un",
    }];
    const service = createConfirmedMealRegistrationService({
      prepareCountableFoodRegistration: vi.fn(async () => ({
        kind: "ready" as const,
        registrationText: "80 g de banana nanica",
        resolutions: [],
        skippedItems,
      })),
      processMeal: vi.fn(async input => ({
        ...processed(input.text ?? ""),
        items: [skippedItems.length ? processed("banana").items[0] : undefined],
      })) as any,
      getHabits: vi.fn(async () => []),
      createDraft: vi.fn(() => ({ draftId: "draft-997-partial-no-continuation" } as any)),
      confirmMeal: vi.fn(async () => savedMeal()) as any,
      consolidateMeal: vi.fn(async (_deps, meal) => ({ action: "created", meal })) as any,
      getGoalProgress: vi.fn(async () => undefined) as any,
      requestPartialRegistrationClarification: vi.fn(async () => ({
        handled: true,
        action: "food_clarification_unavailable",
        reply: "Não foi possível guardar a pergunta.",
        eventType: "whatsapp.food_clarification.persistence_unavailable",
        detail: "fixture",
      })),
    });

    const result = await service({
      userId: 997,
      registrationText: "1 banana nanica, 2 ovos cozidos",
      originalText: "1 banana nanica, 2 ovos cozidos",
      occurredAt: new Date("2026-11-05T12:00:00.000Z"),
      receivedAt: new Date("2026-11-05T12:02:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.status).toBe("registered");
    if (result.status !== "registered") throw new Error("unreachable");
    expect(result.result.reply).toContain("O registro seguro foi salvo");
    expect(result.result.data).toEqual(expect.objectContaining({
      partialRegistration: true,
      continuationPending: false,
    }));
  });
});
