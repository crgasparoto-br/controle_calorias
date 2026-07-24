import { describe, expect, it, vi } from "vitest";
import type {
  CreatePendingOperationInput,
  WhatsAppPendingOperationRecord,
  WhatsAppPendingOperationRepository,
} from "../../repositories/whatsappPendingOperationRepository";
import {
  createFoodQuantityClarificationService,
  type CaloricComplementQuantityContext,
} from "./foodQuantityClarification";

function buildRepository() {
  let captured: CreatePendingOperationInput | null = null;
  const repository: WhatsAppPendingOperationRepository = {
    createPendingOperation: vi.fn(async input => {
      captured = input;
      const now = input.now ?? new Date();
      return {
        id: 903,
        userId: input.userId,
        type: input.type,
        target: input.target,
        origin: input.origin,
        state: "active",
        version: 1,
        createdAt: now,
        expiresAt: new Date(now.getTime() + input.ttlMs),
        updatedAt: now,
        consumedAt: null,
      } as unknown as WhatsAppPendingOperationRecord;
    }),
    getActivePendingOperation: vi.fn(async () => null),
    getLatestPendingOperation: vi.fn(async () => null),
    getPendingOperationById: vi.fn(async () => null),
    claimPendingOperation: vi.fn(async () => ({ claimed: false })),
    cancelPendingOperation: vi.fn(async () => ({ cancelled: false })),
    supersedePendingOperation: vi.fn(async () => ({ superseded: false })),
    purgeInactiveOperations: vi.fn(async () => 0),
  };
  return {
    repository,
    captured: () => captured,
  };
}

describe("clarificação persistente de açúcar", () => {
  it.each([
    {
      operation: { kind: "register", occurredAt: "2026-07-24T12:00:00.000Z" } as const,
      expectedKind: "register",
    },
    {
      operation: {
        kind: "add_to_meal",
        mealId: 41,
        expectedMealLabel: "Café da manhã",
        expectedOccurredAt: "2026-07-24T10:00:00.000Z",
      } as const,
      expectedKind: "add_to_meal",
    },
    {
      operation: {
        kind: "replace_item",
        mealId: 42,
        itemIndex: 1,
        originalFoodName: "Café sem açúcar",
      } as const,
      expectedKind: "replace_item",
    },
  ])("persiste o contexto de $expectedKind antes de qualquer efeito de domínio", async ({ operation, expectedKind }) => {
    const fake = buildRepository();
    const service = createFoodQuantityClarificationService({
      repository: fake.repository,
    });

    const result = await service.requestCaloricComplementQuantity({
      userId: 7,
      originalFoodText: "1 xícara de café com açúcar",
      operation,
      receivedAt: new Date("2026-07-24T12:00:00.000Z"),
      messageId: `wamid-${expectedKind}`,
    });

    expect(result.action).toBe("food_clarification_requested");
    expect(fake.repository.createPendingOperation).toHaveBeenCalledTimes(1);
    const pending = fake.captured();
    expect(pending).not.toBeNull();
    expect(pending?.type).toBe("food_registration_clarification");
    expect(pending?.ttlMs).toBe(10 * 60 * 1000);

    const target = pending?.target as {
      interactionId: string;
      pendingKind: string;
      inboundMessageId: string;
      allowedDomainEffect: string;
      resolutionContext: CaloricComplementQuantityContext;
    };
    expect(target).toEqual(expect.objectContaining({
      interactionId: "food_clarification.quantity",
      pendingKind: "quantity",
      inboundMessageId: `wamid-${expectedKind}`,
      allowedDomainEffect: "complete_pending_food_operation_once",
    }));
    expect(target.resolutionContext).toEqual(expect.objectContaining({
      mode: "complete_caloric_complement",
      componentName: "açúcar",
      originalFoodText: "1 xícara de café com açúcar",
      coffeeQuantity: {
        quantity: 1,
        unit: "xícara",
        estimatedMl: 200,
        cupsEquivalent: 1,
      },
      operation: expect.objectContaining({ kind: expectedKind }),
    }));
  });

  it("preserva volume em mililitros usando a equivalência canônica de uma xícara", async () => {
    const fake = buildRepository();
    const service = createFoodQuantityClarificationService({
      repository: fake.repository,
    });

    await service.requestCaloricComplementQuantity({
      userId: 8,
      originalFoodText: "200 ml de café com açúcar",
      operation: {
        kind: "register",
        occurredAt: "2026-07-24T12:00:00.000Z",
      },
      receivedAt: new Date("2026-07-24T12:00:00.000Z"),
      messageId: "wamid-volume",
    });

    const target = fake.captured()?.target as {
      resolutionContext: CaloricComplementQuantityContext;
    };
    expect(target.resolutionContext.coffeeQuantity).toEqual({
      quantity: 200,
      unit: "ml",
      estimatedMl: 200,
      cupsEquivalent: 1,
    });
  });
});
