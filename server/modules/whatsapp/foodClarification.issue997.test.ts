import { describe, expect, it, vi } from "vitest";
import type { WhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import { calculateMealTotals } from "../../../shared/mealTotals";
import { attachMealMutationPreImage } from "../meals/mealMutationToken";
import { MEAL_UPDATE_SERVICE_OPTIONS } from "../meals/mealUpdateOptions";
import { createFoodQuantityClarificationService } from "./foodQuantityClarification";
import { createWhatsappFoodClarificationService } from "./foodClarification";

const mocks = vi.hoisted(() => ({
  continuePlan: vi.fn(
    async (
      _userId?: number,
      _plan?: any,
      _interactionContext?: { receivedAt?: Date }
    ) => ({
      handled: true,
      action: "meal_item_grams_adjusted",
      reply: "ok",
      eventType: "whatsapp.intent.meal_item_grams_adjusted",
      detail: "aplicado uma vez",
    })
  ),
}));

vi.mock("./mixedMealItemIncrementPlan", () => ({
  continueMixedMealItemIncrementPlan: mocks.continuePlan,
}));

function createRepository() {
  const rows = new Map<number, any>();
  let sequence = 1;
  const claimPendingOperation = vi.fn(async ({ id, expectedVersion }) => {
    const row = rows.get(id);
    if (!row || row.state !== "active" || row.version !== expectedVersion)
      return { claimed: false };
    row.state = "consumed";
    row.version += 1;
    row.consumedAt = new Date();
    return { claimed: true };
  });
  const beginPendingOperationProcessing = vi.fn(
    async ({ id, expectedVersion, now = new Date() }) => {
      const row = rows.get(id);
      if (!row || row.state !== "active" || row.version !== expectedVersion)
        return { claimed: false };
      row.state = "processing";
      row.version += 1;
      row.updatedAt = now;
      return { claimed: true, version: row.version };
    }
  );
  const completePendingOperationProcessing = vi.fn(
    async ({ id, expectedVersion, now = new Date() }) => {
      const row = rows.get(id);
      if (!row || row.state !== "processing" || row.version !== expectedVersion)
        return { completed: false };
      row.state = "consumed";
      row.version += 1;
      row.consumedAt = now;
      row.updatedAt = now;
      return { completed: true };
    }
  );
  const releasePendingOperationProcessing = vi.fn(
    async ({ id, expectedVersion, now = new Date() }) => {
      const row = rows.get(id);
      if (!row || row.state !== "processing" || row.version !== expectedVersion)
        return { released: false };
      row.state = "active";
      row.version += 1;
      row.updatedAt = now;
      return { released: true };
    }
  );
  const requirePendingOperationVerification = vi.fn(
    async ({ id, expectedVersion, now = new Date() }) => {
      const row = rows.get(id);
      if (!row || row.state !== "processing" || row.version !== expectedVersion)
        return { required: false };
      row.state = "review_required";
      row.version += 1;
      row.consumedAt = now;
      row.updatedAt = now;
      return { required: true };
    }
  );
  const repository: WhatsAppPendingOperationRepository = {
    async createPendingOperation(input) {
      const now = input.now ?? new Date();
      const row = {
        id: sequence++,
        ...input,
        state: "active",
        version: 1,
        expiresAt: new Date(now.getTime() + input.ttlMs),
        createdAt: now,
        updatedAt: now,
        consumedAt: null,
      };
      rows.set(row.id, row);
      return row;
    },
    async getActivePendingOperation(userId, now = new Date()) {
      return (
        [...rows.values()]
          .filter(
            row =>
              row.userId === userId &&
              ["active", "processing", "review_required"].includes(row.state) &&
              row.expiresAt >= now
          )
          .sort((left, right) => right.id - left.id)[0] ?? null
      );
    },
    async getPendingOperationById(id) {
      return rows.get(id) ?? null;
    },
    claimPendingOperation,
    beginPendingOperationProcessing,
    completePendingOperationProcessing,
    releasePendingOperationProcessing,
    requirePendingOperationVerification,
    async cancelPendingOperation(id) {
      const row = rows.get(id);
      if (!row || row.state !== "active") return { cancelled: false };
      row.state = "cancelled";
      return { cancelled: true };
    },
    async supersedePendingOperation(id) {
      const row = rows.get(id);
      if (!row || row.state !== "active") return { superseded: false };
      row.state = "superseded";
      return { superseded: true };
    },
    async purgeInactiveOperations() {
      return 0;
    },
  };
  return {
    repository,
    rows,
    claimPendingOperation,
    beginPendingOperationProcessing,
    completePendingOperationProcessing,
    releasePendingOperationProcessing,
    requirePendingOperationVerification,
  };
}

function mixedPlan() {
  return {
    contractVersion: 1 as const,
    originalText:
      "Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela",
    mealLabel: null,
    timeZone: "America/Sao_Paulo",
    operations: [
      {
        targetFood: "requeijao",
        quantity: 48,
        unit: "g" as const,
        gramsDelta: 48,
      },
      { targetFood: "presunto", quantity: 1, unit: "fatia" as const },
      {
        targetFood: "mussarela",
        quantity: 1,
        unit: "fatia" as const,
        inheritedUnit: true,
      },
    ],
  };
}

function clarificationHandler(
  repository: WhatsAppPendingOperationRepository,
  listMeals?: (userId: number) => Promise<any[]>
) {
  return createWhatsappFoodClarificationService({
    repository,
    processFood: vi.fn() as never,
    getHabits: vi.fn(async () => []) as never,
    createMeal: vi.fn() as never,
    listMeals: listMeals ?? (vi.fn(async () => []) as never),
    updateMeal: vi.fn() as never,
    removeMeal: vi.fn() as never,
    createWhatsappMeal: vi.fn() as never,
  });
}

describe("issue #997 persistent mixed increment clarification", () => {
  it("usa receivedAt da interação para o TTL, sem confundir com occurredAt histórico da refeição", async () => {
    const { repository, rows } = createRepository();
    const clarification = createFoodQuantityClarificationService({
      repository,
    });
    const receivedAt = new Date("2026-08-22T20:00:00.000Z");
    const occurredAt = new Date("2026-08-01T12:00:00.000Z");

    await clarification.requestConfirmedTextMealQuantity({
      userId: 42,
      foodName: "ovo frito",
      originalText: "1 ovo frito",
      registrationSegments: ["1 ovo frito"],
      pendingItems: [
        {
          segmentIndex: 0,
          segment: "1 ovo frito",
          foodName: "ovo frito",
          count: 1,
          requestedUnit: "un",
        },
      ],
      currentPendingIndex: 0,
      occurredAt,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.issue997",
    });

    const row = [...rows.values()][0];
    expect(row.createdAt).toEqual(receivedAt);
    expect(row.target.resolutionContext.occurredAt).toBe(
      occurredAt.toISOString()
    );
    expect(row.target.resolutionContext.receivedAt).toBe(
      receivedAt.toISOString()
    );
    expect(row.target.resolutionContext.inboundMessageId).toBe(
      "wamid.issue997"
    );
  });

  it("preserva correlação do comando misto no target persistido e após reconstruir o handler", async () => {
    mocks.continuePlan.mockClear();
    const { repository, rows } = createRepository();
    const clarification = createFoodQuantityClarificationService({
      repository,
    });
    const receivedAt = new Date("2026-08-22T20:00:00.000Z");
    const messageId = "wamid.issue997.mixed-original";
    const plan = {
      ...mixedPlan(),
      receivedAt: receivedAt.toISOString(),
      inboundMessageId: messageId,
    };

    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: plan.originalText,
      plan,
      operationIndex: 1,
      receivedAt,
      messageId,
    });

    const pending = [...rows.values()][0];
    expect(pending.createdAt).toEqual(receivedAt);
    expect(pending.target.inboundMessageId).toBe(messageId);
    expect(pending.target.resolutionContext.plan).toMatchObject({
      receivedAt: receivedAt.toISOString(),
      inboundMessageId: messageId,
      originalText: plan.originalText,
    });

    const restartedHandler = clarificationHandler(repository);
    const resumed = await restartedHandler.handle({
      userId: 42,
      text: "20 g",
      receivedAt: new Date("2026-08-22T20:02:00.000Z"),
      messageId: "wamid.issue997.quantity-reply",
      userTimezone: "America/Sao_Paulo",
    });

    expect(resumed?.action).toBe("meal_item_grams_adjusted");
    expect(mocks.continuePlan).toHaveBeenCalledTimes(1);
    const resumedPlan = mocks.continuePlan.mock.calls[0][1];
    expect(resumedPlan.receivedAt).toBe(receivedAt.toISOString());
    expect(resumedPlan.inboundMessageId).toBe(messageId);
    expect(resumedPlan.operations[1]).toMatchObject({
      gramsDelta: 20,
      resolvedBy: "clarification",
    });
  });

  it("renova o TTL da próxima clarificação em cadeia sem reescrever a correlação original", async () => {
    mocks.continuePlan.mockClear();
    const { repository, rows } = createRepository();
    const clarification = createFoodQuantityClarificationService({
      repository,
    });
    const t0 = new Date("2026-08-22T20:00:00.000Z");
    const replyAt = new Date(t0.getTime() + 9 * 60 * 1000);
    const secondReplyAt = new Date(t0.getTime() + 10 * 60 * 1000 + 1000);
    const messageId = "wamid.issue997.ttl-chain-original";
    const plan = {
      ...mixedPlan(),
      receivedAt: t0.toISOString(),
      inboundMessageId: messageId,
    };

    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: plan.originalText,
      plan,
      operationIndex: 1,
      receivedAt: t0,
      messageId,
    });

    mocks.continuePlan.mockImplementationOnce(
      async (_userId, resumedPlan, interactionContext) => {
        await clarification.requestMealItemIncrementQuantity({
          userId: 42,
          foodName: "Mussarela",
          originalText: resumedPlan.originalText,
          plan: resumedPlan,
          operationIndex: 2,
          receivedAt: interactionContext?.receivedAt,
          messageId: resumedPlan.inboundMessageId,
        });
        return {
          handled: true,
          action: "food_clarification_requested",
          reply: "informe a próxima quantidade",
          eventType: "whatsapp.food_clarification.requested",
          detail: "segunda etapa persistida",
        };
      }
    );

    const firstReply = await clarificationHandler(repository).handle({
      userId: 42,
      text: "20 g",
      receivedAt: replyAt,
      messageId: "wamid.issue997.ttl-chain-first-reply",
      userTimezone: "America/Sao_Paulo",
    });

    expect(firstReply?.action).toBe("food_clarification_requested");
    const secondPending = [...rows.values()].sort(
      (left, right) => right.id - left.id
    )[0];
    expect(secondPending.createdAt).toEqual(replyAt);
    expect(secondPending.expiresAt).toEqual(
      new Date(replyAt.getTime() + 10 * 60 * 1000)
    );
    expect(secondPending.target.resolutionContext.plan).toMatchObject({
      receivedAt: t0.toISOString(),
      inboundMessageId: messageId,
    });

    const secondReply = await clarificationHandler(repository).handle({
      userId: 42,
      text: "18 g",
      receivedAt: secondReplyAt,
      userTimezone: "America/Sao_Paulo",
    });

    expect(secondReply?.action).toBe("meal_item_grams_adjusted");
    expect(mocks.continuePlan).toHaveBeenCalledTimes(2);
  });

  it.each(["1 fatia", "1 unidade", "2 fatias"])(
    "resposta sem massa/volume não consome a pendência: %s",
    async replyText => {
      mocks.continuePlan.mockClear();
      const { repository, claimPendingOperation } = createRepository();
      const clarification = createFoodQuantityClarificationService({
        repository,
      });
      await clarification.requestMealItemIncrementQuantity({
        userId: 42,
        foodName: "Presunto",
        originalText: mixedPlan().originalText,
        plan: mixedPlan(),
        operationIndex: 1,
        receivedAt: new Date(),
      });

      const result = await clarificationHandler(repository).handle({
        userId: 42,
        text: replyText,
        receivedAt: new Date(),
        userTimezone: "America/Sao_Paulo",
      });

      expect(result?.action).toBe("food_clarification_reprompted");
      expect(claimPendingOperation).not.toHaveBeenCalled();
      expect(mocks.continuePlan).not.toHaveBeenCalled();
    }
  );

  it("resposta sem massa/volume não consome a continuação do registro parcial", async () => {
    const { repository, rows, claimPendingOperation } = createRepository();
    const occurredAt = new Date("2026-11-05T12:00:00.000Z");
    const clarification = createFoodQuantityClarificationService({ repository });
    await clarification.requestPartialConfirmedTextMealQuantity({
      userId: 997,
      originalText: "1 banana nanica, 1 ovo cozido",
      pendingItems: [
        {
          segmentIndex: 1,
          segment: "1 ovo cozido",
          foodName: "ovo cozido",
          count: 1,
          requestedUnit: "un",
        },
      ],
      currentPendingIndex: 0,
      resolvedQuantities: [null],
      occurredAt,
      receivedAt: new Date("2026-11-05T12:02:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      expectedMealId: 99701,
      expectedMealLabel: "Café da manhã",
      expectedMealOccurredAt: occurredAt.toISOString(),
    });

    const result = await clarificationHandler(repository).handle({
      userId: 997,
      text: "1 unidade",
      receivedAt: new Date("2026-11-05T12:03:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.action).toBe("food_clarification_reprompted");
    expect(claimPendingOperation).not.toHaveBeenCalled();
    expect([...rows.values()][0].state).toBe("active");
  });

  it("duas respostas concorrentes/retry continuam o plano exatamente uma vez", async () => {
    mocks.continuePlan.mockClear();
    const {
      repository,
      claimPendingOperation,
      beginPendingOperationProcessing,
    } = createRepository();
    const clarification = createFoodQuantityClarificationService({
      repository,
    });
    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: mixedPlan().originalText,
      plan: mixedPlan(),
      operationIndex: 1,
      receivedAt: new Date(),
    });

    const firstProcess = clarificationHandler(repository);
    const restartedProcess = clarificationHandler(repository);
    const [first, retry] = await Promise.all([
      firstProcess.handle({
        userId: 42,
        text: "20 g",
        receivedAt: new Date(),
        userTimezone: "America/Sao_Paulo",
      }),
      restartedProcess.handle({
        userId: 42,
        text: "20 g",
        receivedAt: new Date(),
        userTimezone: "America/Sao_Paulo",
      }),
    ]);

    expect(claimPendingOperation).not.toHaveBeenCalled();
    expect(beginPendingOperationProcessing).toHaveBeenCalledTimes(1);
    expect(mocks.continuePlan).toHaveBeenCalledTimes(1);
    expect([first?.action, retry?.action]).toContain(
      "meal_item_grams_adjusted"
    );
    expect([first?.action, retry?.action]).toContain(
      "food_clarification_unavailable"
    );
  });

  it("libera a mesma pendência após falha comprovadamente anterior à mutação", async () => {
    mocks.continuePlan.mockClear();
    const {
      repository,
      rows,
      beginPendingOperationProcessing,
      releasePendingOperationProcessing,
      completePendingOperationProcessing,
    } = createRepository();
    const clarification = createFoodQuantityClarificationService({ repository });
    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: mixedPlan().originalText,
      plan: mixedPlan(),
      operationIndex: 1,
      receivedAt: new Date("2026-08-22T20:00:00.000Z"),
    });
    mocks.continuePlan.mockRejectedValueOnce(new Error("falha antes da escrita"));

    const handler = clarificationHandler(repository);
    const first = await handler.handle({
      userId: 42,
      text: "20 g",
      receivedAt: new Date("2026-08-22T20:01:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(first?.action).toBe("food_clarification_retryable_failure");
    expect(beginPendingOperationProcessing).toHaveBeenCalledTimes(1);
    expect(releasePendingOperationProcessing).toHaveBeenCalledTimes(1);
    expect(completePendingOperationProcessing).not.toHaveBeenCalled();
    expect([...rows.values()][0]).toMatchObject({ state: "active", version: 3 });

    const retry = await handler.handle({
      userId: 42,
      text: "20 g",
      receivedAt: new Date("2026-08-22T20:02:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });
    expect(retry?.action).toBe("meal_item_grams_adjusted");
    expect(mocks.continuePlan).toHaveBeenCalledTimes(2);
    expect([...rows.values()][0].state).toBe("consumed");
  });

  it("marca review_required quando o efeito do plano não pode ser determinado", async () => {
    mocks.continuePlan.mockClear();
    const { repository, rows, requirePendingOperationVerification } =
      createRepository();
    const clarification = createFoodQuantityClarificationService({ repository });
    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: mixedPlan().originalText,
      plan: mixedPlan(),
      operationIndex: 1,
      receivedAt: new Date("2026-08-22T20:00:00.000Z"),
    });
    const meals: any[] = [];
    mocks.continuePlan.mockImplementationOnce(async () => {
      meals.push({
        id: 9001,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-08-22T19:00:00.000Z"),
        items: [],
      });
      throw new Error("falha após efeito potencial");
    });

    const result = await clarificationHandler(
      repository,
      vi.fn(async () => meals) as never
    ).handle({
      userId: 42,
      text: "20 g",
      receivedAt: new Date("2026-08-22T20:01:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.action).toBe("food_clarification_unavailable");
    expect(result?.data).toEqual(
      expect.objectContaining({
        verificationRequired: true,
        retryBlockedToPreventDuplicate: true,
        pendingState: "review_required",
      })
    );
    expect(requirePendingOperationVerification).toHaveBeenCalledTimes(1);
    expect([...rows.values()][0].state).toBe("review_required");
    expect(mocks.continuePlan).toHaveBeenCalledTimes(1);
  });

  it("bloqueia reentrada enquanto a resposta idêntica ainda está processing", async () => {
    mocks.continuePlan.mockClear();
    const { repository, rows, beginPendingOperationProcessing } =
      createRepository();
    const clarification = createFoodQuantityClarificationService({ repository });
    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: mixedPlan().originalText,
      plan: mixedPlan(),
      operationIndex: 1,
      receivedAt: new Date("2026-08-22T20:00:00.000Z"),
    });
    const pending = [...rows.values()][0];
    await beginPendingOperationProcessing({
      id: pending.id,
      expectedVersion: pending.version,
      now: new Date("2026-08-22T20:01:00.000Z"),
    });

    const result = await clarificationHandler(repository).handle({
      userId: 42,
      text: "20 g",
      receivedAt: new Date("2026-08-22T20:01:01.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.action).toBe("food_clarification_unavailable");
    expect(result?.data).toEqual(
      expect.objectContaining({
        pendingState: "processing",
        retryBlockedToPreventDuplicate: true,
      })
    );
    expect(mocks.continuePlan).not.toHaveBeenCalled();
  });

  it("não repete automaticamente uma resposta idêntica em review_required", async () => {
    mocks.continuePlan.mockClear();
    const {
      repository,
      rows,
      beginPendingOperationProcessing,
      requirePendingOperationVerification,
    } = createRepository();
    const clarification = createFoodQuantityClarificationService({ repository });
    await clarification.requestMealItemIncrementQuantity({
      userId: 42,
      foodName: "Presunto",
      originalText: mixedPlan().originalText,
      plan: mixedPlan(),
      operationIndex: 1,
      receivedAt: new Date("2026-08-22T20:00:00.000Z"),
    });
    const pending = [...rows.values()][0];
    const claim = await beginPendingOperationProcessing({
      id: pending.id,
      expectedVersion: pending.version,
      now: new Date("2026-08-22T20:01:00.000Z"),
    });
    await requirePendingOperationVerification({
      id: pending.id,
      expectedVersion: claim.version,
      now: new Date("2026-08-22T20:02:00.000Z"),
    });

    const result = await clarificationHandler(repository).handle({
      userId: 42,
      text: "20 g",
      receivedAt: new Date("2026-08-22T20:02:01.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result?.action).toBe("food_clarification_unavailable");
    expect(result?.data).toEqual(
      expect.objectContaining({
        pendingState: "review_required",
        retryBlockedToPreventDuplicate: true,
      })
    );
    expect(mocks.continuePlan).not.toHaveBeenCalled();
  });

  it("retoma o registro parcial após reinício sem recalcular nem duplicar os itens seguros", async () => {
    const { repository, rows } = createRepository();
    const occurredAt = new Date("2026-11-05T12:00:00.000Z");
    const firstReceivedAt = new Date("2026-11-05T12:02:00.000Z");
    const secondReceivedAt = new Date("2026-11-05T12:03:00.000Z");
    const safeItem = {
      foodName: "Banana nanica",
      canonicalName: "Banana nanica",
      portionText: "80 g",
      quantity: 80,
      unit: "g",
      estimatedGrams: 80,
      calories: 71,
      protein: 0.9,
      carbs: 18.3,
      fat: 0.2,
      fiber: 2.6,
      source: "catalog",
    };
    let meal: any = {
      id: 99701,
      userId: 997,
      mealLabel: "Café da manhã",
      occurredAt,
      notes: "1 banana nanica, 2 ovos cozidos, 1 fatia de presunto",
      items: [safeItem],
    };
    const preImage = "a".repeat(64);
    const listMeals = vi.fn(async (_userId: number, options?: { adjustmentRead?: boolean }) =>
      options?.adjustmentRead
        ? [attachMealMutationPreImage({ ...meal }, preImage)]
        : [meal]
    );
    const processFood = vi.fn(async ({ text }: { text: string }) => {
      const match = text.match(/^([\d,.]+)\s*(g|ml)\s+de\s+(.+)$/i);
      if (!match) throw new Error("fixture esperava quantidade explícita");
      const quantity = Number(match[1].replace(",", "."));
      const unit = match[2].toLowerCase();
      const foodName = match[3];
      return {
        items: [{
          ...safeItem,
          foodName,
          canonicalName: foodName,
          portionText: `${quantity} ${unit}`,
          quantity,
          unit,
          estimatedGrams: quantity,
          calories: quantity * 1.5,
          protein: quantity * 0.1,
          carbs: quantity * 0.2,
          fat: quantity * 0.05,
          fiber: 0,
        }],
        totals: { calories: quantity * 1.5, protein: 0, carbs: 0, fat: 0 },
      } as any;
    });
    const updateMeal = vi.fn(async (_userId: number, input: any) => {
      meal = { ...meal, ...input, occurredAt: new Date(input.occurredAt) };
      return meal;
    });
    const handler = createWhatsappFoodClarificationService({
      repository,
      processFood: processFood as never,
      getHabits: vi.fn(async () => []) as never,
      createMeal: vi.fn() as never,
      listMeals: listMeals as never,
      updateMeal: updateMeal as never,
      removeMeal: vi.fn() as never,
      createWhatsappMeal: vi.fn(async () => meal) as never,
    });
    const continuation = createFoodQuantityClarificationService({ repository });
    const pendingItems = [
      {
        segmentIndex: 1,
        segment: "2 ovos cozidos",
        foodName: "ovos cozidos",
        brand: null,
        count: 2,
        requestedUnit: "un",
      },
      {
        segmentIndex: 2,
        segment: "1 fatia de presunto",
        foodName: "presunto",
        brand: null,
        count: 1,
        requestedUnit: "fatia",
      },
    ];
    await continuation.requestPartialConfirmedTextMealQuantity({
      userId: 997,
      originalText: "1 banana nanica, 2 ovos cozidos, 1 fatia de presunto",
      pendingItems,
      currentPendingIndex: 0,
      resolvedQuantities: [null, null],
      occurredAt,
      receivedAt: firstReceivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid.issue997.partial-origin",
      expectedMealId: meal.id,
      expectedMealLabel: meal.mealLabel,
      expectedMealOccurredAt: occurredAt.toISOString(),
    });

    const firstReply = await handler.handle({
      userId: 997,
      text: "100 g",
      receivedAt: firstReceivedAt,
      messageId: "wamid.issue997.partial-reply-1",
      userTimezone: "America/Sao_Paulo",
    });
    expect(firstReply?.action).toBe("food_clarification_requested");
    expect(updateMeal).not.toHaveBeenCalled();
    const secondPending = [...rows.values()].sort(
      (left, right) => right.id - left.id,
    )[0];
    expect(secondPending.createdAt).toEqual(firstReceivedAt);
    expect(secondPending.target.inboundMessageId).toBe(
      "wamid.issue997.partial-origin",
    );
    expect(secondPending.target.resolutionContext).toMatchObject({
      mode: "complete_partial_confirmed_text_meal",
      currentPendingIndex: 1,
      resolvedQuantities: [{ quantity: 100, unit: "g" }, null],
      expectedMealId: 99701,
    });

    const resumedHandler = createWhatsappFoodClarificationService({
      repository,
      processFood: processFood as never,
      getHabits: vi.fn(async () => []) as never,
      createMeal: vi.fn() as never,
      listMeals: listMeals as never,
      updateMeal: updateMeal as never,
      removeMeal: vi.fn() as never,
      createWhatsappMeal: vi.fn(async () => meal) as never,
    });
    const completed = await resumedHandler.handle({
      userId: 997,
      text: "30 g",
      receivedAt: secondReceivedAt,
      messageId: "wamid.issue997.partial-reply-2",
      userTimezone: "America/Sao_Paulo",
    });
    expect(completed).toEqual(expect.objectContaining({
      action: "food_clarification_completed",
      eventType: "whatsapp.food_clarification.partial_confirmed_text_meal.completed",
      data: expect.objectContaining({
        mealId: 99701,
        addedItemCount: 2,
        partialRegistration: false,
      }),
    }));
    expect(updateMeal).toHaveBeenCalledTimes(1);
    expect(updateMeal).toHaveBeenCalledWith(997, expect.objectContaining({
      mealId: 99701,
      items: [
        safeItem,
        expect.objectContaining({ foodName: "ovos cozidos", quantity: 100 }),
        expect.objectContaining({ foodName: "presunto", quantity: 30 }),
      ],
    }));
    expect(updateMeal.mock.calls[0][1][MEAL_UPDATE_SERVICE_OPTIONS]).toEqual({
      expectedPreImage: preImage,
    });
    expect(meal.items[0]).toEqual(safeItem);
    expect(meal.items.filter((item: any) => item.foodName === "Banana nanica")).toHaveLength(1);
    expect(processFood).toHaveBeenCalledTimes(2);
    expect(calculateMealTotals(meal.items)).toEqual({
      calories: 266,
      protein: 13.9,
      carbs: 44.3,
      fat: 6.7,
    });

    await resumedHandler.handle({
      userId: 997,
      text: "30 g",
      receivedAt: secondReceivedAt,
      messageId: "wamid.issue997.partial-reply-2",
      userTimezone: "America/Sao_Paulo",
    });
    expect(updateMeal).toHaveBeenCalledTimes(1);
  });
});
