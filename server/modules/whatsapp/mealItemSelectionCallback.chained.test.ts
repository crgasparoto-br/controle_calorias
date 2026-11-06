import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const createPendingOperationMock = vi.hoisted(() => vi.fn());
const continueMixedPlanMock = vi.hoisted(() => vi.fn());
const getActivePendingOperationMock = vi.hoisted(() => vi.fn());
const beginPendingOperationProcessingMock = vi.hoisted(() => vi.fn());
const completePendingOperationProcessingMock = vi.hoisted(() => vi.fn());
const releasePendingOperationProcessingMock = vi.hoisted(() => vi.fn());
const requirePendingOperationVerificationMock = vi.hoisted(() => vi.fn());
const pendingOperationProcessingLeaseMs = vi.hoisted(() => 5 * 60 * 1000);
const getMealMutationPreImageMock = vi.hoisted(() =>
  vi.fn((meal: { mutationPreImage?: string }) => meal.mutationPreImage ?? null)
);
const mealUpdateOptionsKey = vi.hoisted(() =>
  Symbol("meal_update_service_options")
);

vi.mock("../../db", () => ({ getDb: vi.fn(), logPersistenceWarning: vi.fn() }));
vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
  getMealMutationPreImage: getMealMutationPreImageMock,
  MEAL_UPDATE_SERVICE_OPTIONS: mealUpdateOptionsKey,
}));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  PENDING_OPERATION_PROCESSING_LEASE_MS: pendingOperationProcessingLeaseMs,
  createDrizzleWhatsAppPendingOperationRepository: () => ({
    createPendingOperation: createPendingOperationMock,
    getActivePendingOperation: getActivePendingOperationMock,
    claimPendingOperation: vi.fn(),
    beginPendingOperationProcessing: beginPendingOperationProcessingMock,
    completePendingOperationProcessing: completePendingOperationProcessingMock,
    releasePendingOperationProcessing: releasePendingOperationProcessingMock,
    requirePendingOperationVerification:
      requirePendingOperationVerificationMock,
    cancelPendingOperation: vi.fn(),
  }),
}));
vi.mock("./mixedMealItemIncrementPlan", () => ({
  continueMixedMealItemIncrementPlan: continueMixedPlanMock,
}));

import {
  completeMealItemSelectionInteractiveCallback,
  resolveTextMealItemSelection,
  type PendingMealItemSelection,
} from "./mealItemSelectionCallback";
import { attachMealMutationPreImage } from "../meals/mealMutationToken";

function item(foodName: string) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: "50 g",
    quantity: 50,
    unit: "g",
    servings: 1,
    estimatedGrams: 50,
    calories: 100,
    protein: 5,
    carbs: 10,
    fat: 4,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

function mealsFixture() {
  return [
    attachMealMutationPreImage(
      {
        id: 1,
        mealLabel: "Jantar",
        occurredAt: "2026-07-12T22:00:00.000Z",
        notes: null,
        items: [item("Queijo minas"), item("Pão francês")],
      },
      "a".repeat(64)
    ),
    attachMealMutationPreImage(
      {
        id: 2,
        mealLabel: "Lanche",
        occurredAt: "2026-07-12T21:00:00.000Z",
        notes: null,
        items: [item("Queijo mussarela"), item("Pão integral")],
      },
      "b".repeat(64)
    ),
  ];
}

describe("meal item selection — ambiguidades encadeadas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingOperationMock.mockResolvedValue({ id: 999 });
    getActivePendingOperationMock.mockResolvedValue(null);
    beginPendingOperationProcessingMock.mockResolvedValue({
      claimed: true,
      version: 2,
    });
    completePendingOperationProcessingMock.mockResolvedValue({
      completed: true,
    });
    releasePendingOperationProcessingMock.mockResolvedValue({ released: true });
    requirePendingOperationVerificationMock.mockResolvedValue({
      required: true,
    });
    continueMixedPlanMock.mockResolvedValue({
      handled: true,
      action: "meal_item_grams_adjusted",
      reply: "ok",
      eventType: "ok",
      detail: "ok",
    });
    listMealsMock.mockResolvedValue(mealsFixture());
    updateMealMock.mockImplementation(
      async (_userId: number, input: Record<string, unknown>) =>
        attachMealMutationPreImage(
          { id: input.mealId, ...input },
          "f".repeat(64)
        )
    );
  });

  it("não escreve na primeira escolha e aplica todas as ações somente após a última", async () => {
    const firstPending: PendingMealItemSelection = {
      targetFood: "queijo",
      action: { kind: "replace_food", targetFood: "ricota" },
      contextLabel: "nas refeições recentes",
      resultTitle: "Alimentos substituídos",
      candidates: [
        {
          mealId: 1,
          mealLabel: "Jantar",
          itemIndex: 0,
          itemName: "Queijo minas",
        },
        {
          mealId: 2,
          mealLabel: "Lanche",
          itemIndex: 0,
          itemName: "Queijo mussarela",
        },
      ],
      remainingSelections: [
        {
          targetFood: "pão",
          action: { kind: "replace_food", targetFood: "tapioca" },
          contextLabel: "nas refeições recentes",
          candidates: [
            {
              mealId: 1,
              mealLabel: "Jantar",
              itemIndex: 1,
              itemName: "Pão francês",
            },
            {
              mealId: 2,
              mealLabel: "Lanche",
              itemIndex: 1,
              itemName: "Pão integral",
            },
          ],
        },
      ],
    };

    const unclaimedResult = await completeMealItemSelectionInteractiveCallback(
      42,
      { target: firstPending },
      "select:0"
    );
    expect(unclaimedResult.eventType).toBe(
      "whatsapp.intent.meal_item_selection_claim_required"
    );
    expect(updateMealMock).not.toHaveBeenCalled();

    const firstResult = await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 90, version: 1, state: "processing", target: firstPending },
      "select:0"
    );

    expect(firstResult.action).toBe("clarification_needed");
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(createPendingOperationMock).toHaveBeenCalledOnce();
    const secondPending = createPendingOperationMock.mock.calls[0][0]
      .target as PendingMealItemSelection;
    expect(secondPending.companionActions).toEqual([
      {
        candidate: firstPending.candidates[0],
        action: { kind: "replace_food", targetFood: "ricota" },
      },
    ]);
    expect(secondPending.action).toEqual({
      kind: "replace_food",
      targetFood: "tapioca",
    });

    const finalResult = await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 999, version: 1, state: "processing", target: secondPending },
      "select:1"
    );

    expect(updateMealMock).toHaveBeenCalledTimes(2);
    expect(updateMealMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        mealId: 1,
        items: expect.arrayContaining([
          expect.objectContaining({ foodName: "ricota" }),
        ]),
      })
    );
    expect(updateMealMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        mealId: 2,
        items: expect.arrayContaining([
          expect.objectContaining({ foodName: "tapioca" }),
        ]),
      })
    );
    expect(finalResult.action).toBe("meal_item_replaced");
    expect(finalResult.data).toEqual(
      expect.objectContaining({
        actionCount: 2,
        affectedMealIds: expect.arrayContaining([1, 2]),
      })
    );
    expect(finalResult.reply.match(/Total da refeição:/g)).toHaveLength(2);
  });

  it("encaminha o instante da escolha como relógio da próxima etapa do plano, sem alterar a correlação original", async () => {
    const originalReceivedAt = new Date("2026-08-22T20:00:00.000Z");
    const callbackAt = new Date(originalReceivedAt.getTime() + 9 * 60 * 1000);
    const messageId = "wamid.issue997.selection-original";
    const pending: PendingMealItemSelection = {
      targetFood: "presunto",
      action: { kind: "mixed_increment_target", operationIndex: 0 },
      contextLabel: "na refeição",
      resultTitle: "Alimento ajustado",
      candidates: [
        { mealId: 1, mealLabel: "Jantar", itemIndex: 0, itemName: "Presunto" },
      ],
      continuation: {
        kind: "mixed_increment_plan",
        plan: {
          contractVersion: 1,
          originalText: "Adicionar uma fatia ao presunto",
          mealLabel: null,
          timeZone: "America/Sao_Paulo",
          receivedAt: originalReceivedAt.toISOString(),
          inboundMessageId: messageId,
          operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
        },
      },
    };

    await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 77, version: 2, state: "processing", target: pending },
      "select:0",
      callbackAt
    );

    expect(continueMixedPlanMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        receivedAt: originalReceivedAt.toISOString(),
        inboundMessageId: messageId,
      }),
      { receivedAt: callbackAt }
    );
    expect(completePendingOperationProcessingMock).toHaveBeenCalledWith({
      id: 77,
      expectedVersion: 2,
      now: callbackAt,
    });
  });

  it("reivindica uma resposta textual com lease e conserva correlation original após retomada", async () => {
    const originalReceivedAt = new Date("2026-08-22T20:00:00.000Z");
    const responseAt = new Date(originalReceivedAt.getTime() + 9 * 60 * 1000);
    const messageId = "wamid.issue997.text-selection-original";
    const pending: PendingMealItemSelection = {
      targetFood: "presunto",
      action: { kind: "mixed_increment_target", operationIndex: 0 },
      contextLabel: "na refeição",
      resultTitle: "Alimento ajustado",
      candidates: [
        { mealId: 1, mealLabel: "Jantar", itemIndex: 0, itemName: "Presunto" },
      ],
      continuation: {
        kind: "mixed_increment_plan",
        plan: {
          contractVersion: 1,
          originalText: "Adicionar uma fatia ao presunto",
          mealLabel: null,
          timeZone: "America/Sao_Paulo",
          receivedAt: originalReceivedAt.toISOString(),
          inboundMessageId: messageId,
          operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
        },
      },
    };
    getActivePendingOperationMock.mockResolvedValue({
      id: 90,
      userId: 42,
      type: "meal_item_selection",
      target: pending,
      state: "active",
      version: 4,
      expiresAt: new Date(responseAt.getTime() + 60_000),
    });
    beginPendingOperationProcessingMock.mockResolvedValue({
      claimed: true,
      version: 5,
    });

    const result = await resolveTextMealItemSelection(42, "1", responseAt);

    expect(result?.action).toBe("meal_item_grams_adjusted");
    expect(beginPendingOperationProcessingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 90,
        expectedVersion: 4,
        now: responseAt,
      })
    );
    expect(continueMixedPlanMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        receivedAt: originalReceivedAt.toISOString(),
        inboundMessageId: messageId,
      }),
      { receivedAt: responseAt }
    );
    expect(completePendingOperationProcessingMock).toHaveBeenCalledWith({
      id: 90,
      expectedVersion: 5,
      now: responseAt,
    });
  });

  it("não reaplica resposta textual de uma lease abandonada em review_required", async () => {
    const pending: PendingMealItemSelection = {
      targetFood: "queijo",
      action: { kind: "grams_delta", delta: 10 },
      contextLabel: "na refeição",
      resultTitle: "Alimento ajustado",
      candidates: [
        {
          mealId: 1,
          mealLabel: "Jantar",
          itemIndex: 0,
          itemName: "Queijo minas",
        },
      ],
    };
    getActivePendingOperationMock.mockResolvedValue({
      id: 95,
      userId: 42,
      type: "meal_item_selection",
      target: pending,
      state: "review_required",
      version: 3,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await resolveTextMealItemSelection(42, "1", new Date());

    expect(result?.eventType).toBe(
      "whatsapp.intent.meal_item_selection_review_required"
    );
    expect(result?.data).toEqual(
      expect.objectContaining({ pendingOperationId: 95, fallbackBlocked: true })
    );
    expect(beginPendingOperationProcessingMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(continueMixedPlanMock).not.toHaveBeenCalled();
  });

  it("restaura a primeira refeição quando a segunda atualização do callback falha", async () => {
    const meals = mealsFixture();
    const state = new Map(meals.map(meal => [meal.id, structuredClone(meal)]));
    let failSecondOnce = true;
    listMealsMock.mockResolvedValue(meals);
    updateMealMock.mockImplementation(
      async (_userId: number, input: Record<string, unknown>) => {
        const mealId = Number(input.mealId);
        const items = input.items as Array<{ foodName: string }>;
        if (
          mealId === 1 &&
          items.some(candidate => candidate.foodName === "tapioca") &&
          failSecondOnce
        ) {
          failSecondOnce = false;
          throw new Error("falha simulada na segunda refeição");
        }
        const saved = attachMealMutationPreImage(
          { id: mealId, ...input, items },
          "f".repeat(64)
        );
        state.set(
          mealId,
          structuredClone(saved) as ReturnType<typeof mealsFixture>[number]
        );
        return saved;
      }
    );

    const pending: PendingMealItemSelection = {
      targetFood: "pão",
      action: { kind: "replace_food", targetFood: "tapioca" },
      contextLabel: "nas refeições recentes",
      resultTitle: "Alimentos substituídos",
      candidates: [
        {
          mealId: 1,
          mealLabel: "Jantar",
          itemIndex: 1,
          itemName: "Pão francês",
        },
      ],
      companionActions: [
        {
          candidate: {
            mealId: 2,
            mealLabel: "Lanche",
            itemIndex: 0,
            itemName: "Queijo mussarela",
          },
          action: { kind: "replace_food", targetFood: "ricota" },
        },
      ],
    };

    const result = await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 91, version: 1, state: "processing", target: pending },
      "select:0"
    );

    expect(result.action).toBe("clarification_needed");
    expect(result.eventType).toBe(
      "whatsapp.intent.meal_item_selection_review_required"
    );
    expect(result.data).toEqual(
      expect.objectContaining({ pendingOperationId: 91, fallbackBlocked: true })
    );
    expect(state.get(1)?.items.map(candidate => candidate.foodName)).toEqual([
      "Queijo minas",
      "Pão francês",
    ]);
    expect(state.get(2)?.items.map(candidate => candidate.foodName)).toEqual([
      "Queijo mussarela",
      "Pão integral",
    ]);
    expect(updateMealMock).toHaveBeenCalledTimes(3);
  });

  it("fails closed after a mutation whose claim cannot be finalized, then blocks duplicate retry", async () => {
    const originalReceivedAt = new Date("2026-08-22T20:00:00.000Z");
    const pending: PendingMealItemSelection = {
      targetFood: "presunto",
      action: { kind: "mixed_increment_target", operationIndex: 0 },
      contextLabel: "na refeição",
      resultTitle: "Alimento ajustado",
      candidates: [
        { mealId: 1, mealLabel: "Jantar", itemIndex: 0, itemName: "Presunto" },
      ],
      continuation: {
        kind: "mixed_increment_plan",
        plan: {
          contractVersion: 1,
          originalText: "Adicionar uma fatia ao presunto",
          mealLabel: null,
          timeZone: "America/Sao_Paulo",
          receivedAt: originalReceivedAt.toISOString(),
          inboundMessageId: "wamid.issue997.post-mutation-crash",
          operations: [{ targetFood: "presunto", quantity: 1, unit: "fatia" }],
        },
      },
    };
    const applied = {
      handled: true as const,
      action: "meal_item_grams_adjusted" as const,
      reply: "Alimento ajustado.",
      eventType: "whatsapp.intent.meal_item_grams_adjusted",
      detail: "O CAS confirmou uma única mutação.",
      data: {},
    };
    continueMixedPlanMock
      .mockImplementationOnce(async () => {
        await updateMealMock(42, {
          mealId: 1,
          items: [item("Presunto ajustado")],
        });
        return applied;
      })
      .mockResolvedValueOnce({
        handled: true,
        action: "clarification_needed",
        reply: "A refeição mudou desde a seleção.",
        eventType: "whatsapp.intent.meal_item_selection_stale",
        detail: "O pre-image original já não corresponde ao estado atual.",
        data: {},
      });
    completePendingOperationProcessingMock.mockResolvedValueOnce({
      completed: false,
    });
    requirePendingOperationVerificationMock
      .mockResolvedValueOnce({ required: false })
      .mockResolvedValueOnce({ required: true });

    await expect(
      completeMealItemSelectionInteractiveCallback(
        42,
        { id: 92, version: 2, state: "processing", target: pending },
        "select:0",
        originalReceivedAt
      )
    ).rejects.toThrow(
      "Não foi possível persistir review_required para uma seleção de resultado incerto."
    );

    const retry = await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 92, version: 3, state: "processing", target: pending },
      "select:0",
      new Date(
        originalReceivedAt.getTime() + pendingOperationProcessingLeaseMs + 1
      )
    );

    expect(retry.eventType).toBe(
      "whatsapp.intent.meal_item_selection_review_required"
    );
    expect(retry.data).toEqual(
      expect.objectContaining({ pendingOperationId: 92, fallbackBlocked: true })
    );
    expect(updateMealMock).toHaveBeenCalledTimes(1);
    expect(continueMixedPlanMock).toHaveBeenCalledTimes(2);
    expect(requirePendingOperationVerificationMock).toHaveBeenCalledTimes(2);
  });

  it("preserva a ordem original em ações sobre o mesmo item", async () => {
    const first: PendingMealItemSelection = {
      targetFood: "queijo",
      action: { kind: "grams_delta", delta: 10 },
      contextLabel: "na refeição",
      resultTitle: "Alimento ajustado",
      candidates: [
        {
          mealId: 1,
          mealLabel: "Jantar",
          itemIndex: 0,
          itemName: "Queijo minas",
        },
      ],
      remainingSelections: [
        {
          targetFood: "o mesmo queijo",
          action: { kind: "grams_absolute", grams: 80 },
          contextLabel: "na refeição",
          candidates: [
            {
              mealId: 1,
              mealLabel: "Jantar",
              itemIndex: 0,
              itemName: "Queijo minas",
            },
          ],
        },
      ],
    };
    await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 93, version: 1, state: "processing", target: first },
      "select:0"
    );
    const second = createPendingOperationMock.mock.calls[0][0]
      .target as PendingMealItemSelection;
    const result = await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 999, version: 1, state: "processing", target: second },
      "select:0"
    );
    expect(result.action).toBe("meal_item_grams_adjusted");
    expect(updateMealMock.mock.calls[0][1].items[0].estimatedGrams).toBe(80);
  });

  it("mantém a identidade após renomeação anterior do mesmo item", async () => {
    const first: PendingMealItemSelection = {
      targetFood: "queijo",
      action: { kind: "replace_food", targetFood: "ricota" },
      contextLabel: "na refeição",
      resultTitle: "Alimento substituído",
      candidates: [
        {
          mealId: 1,
          mealLabel: "Jantar",
          itemIndex: 0,
          itemName: "Queijo minas",
        },
      ],
      remainingSelections: [
        {
          targetFood: "o mesmo item",
          action: { kind: "replace_food", targetFood: "tofu" },
          contextLabel: "na refeição",
          candidates: [
            {
              mealId: 1,
              mealLabel: "Jantar",
              itemIndex: 0,
              itemName: "Queijo minas",
            },
          ],
        },
      ],
    };
    await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 94, version: 1, state: "processing", target: first },
      "select:0"
    );
    const second = createPendingOperationMock.mock.calls[0][0]
      .target as PendingMealItemSelection;
    const result = await completeMealItemSelectionInteractiveCallback(
      42,
      { id: 999, version: 1, state: "processing", target: second },
      "select:0"
    );
    expect(result.action).toBe("meal_item_replaced");
    expect(updateMealMock.mock.calls[0][1].items[0].foodName).toBe("tofu");
  });
});
