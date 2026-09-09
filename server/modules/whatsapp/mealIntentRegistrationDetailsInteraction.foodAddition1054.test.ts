import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  handleAddition: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: async () => null,
  logPersistenceWarning: vi.fn(),
}));
vi.mock("./intent/foodAdditionHandlers", () => ({
  handleFoodAdditionIntent: (...args: unknown[]) => boundary.handleAddition(...args),
}));

import {
  createWhatsappMealIntentRegistrationDetailsInteraction,
  resolveWhatsappMealIntentRegistrationDetailsText,
} from "./mealIntentRegistrationDetailsInteraction";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});
const now = new Date("2026-09-09T10:00:00Z");
let userId = 105540;

beforeEach(() => {
  vi.clearAllMocks();
  userId += 1;
  boundary.handleAddition.mockResolvedValue({
    handled: true,
    action: "meal_item_added",
    reply: "Alimento adicionado.",
    eventType: "whatsapp.intent.meal_item_added",
    detail: "Adição retomada uma vez.",
  });
});

async function createPending() {
  await createWhatsappMealIntentRegistrationDetailsInteraction({
    userId,
    originalText: "adicionar 2 fatias de pão de forma Panco ao café da manhã",
    registrationText: "2 fatias de pão de forma Panco",
    inboundMessageId: "wamid-addition-1054",
    prompt: "Qual variante Panco você quis registrar?",
    receivedAt: now,
    foodAdditionContext: {
      addition: {
        mealLabel: "Café da manhã",
        date: now.toISOString(),
        items: [
          {
            foodName: "Leite integral",
            brand: null,
            quantity: 50,
            unit: "ml",
          },
          {
            foodName: "Pão de forma Panco",
            brand: "Panco",
            quantity: 2,
            unit: "fatia",
          },
        ],
      },
      itemIndex: 1,
      expectedMealId: 1054,
      expectedMealLabel: "Café da manhã",
      expectedOccurredAt: now.toISOString(),
      receivedAt: now.toISOString(),
      userTimezone: "America/Sao_Paulo",
      resolvedItems: [{
        foodName: "Leite integral",
        canonicalName: "Leite integral",
        brand: null,
        quantity: 50,
        unit: "ml",
        portionText: "50 ml",
        servings: 0.5,
        estimatedGrams: 50,
        calories: 30,
        protein: 1.5,
        carbs: 2.4,
        fat: 1.5,
        confidence: 0.95,
        source: "catalog",
      }],
      clarification: {
        originalText: "Pão de forma Panco",
        foodName: "Pão de forma Panco",
        brand: "Panco",
        clarificationReason: "brand_variant_unresolved",
        alternatives: [
            {
              name: "Pão de forma Panco Premium",
              brand: "Panco",
              productVariant: "premium",
              servingLabel: "2 fatias (50 g)",
              gramsPerServing: 50,
            },
            {
              name: "Pão de forma Panco Integral",
              brand: "Panco",
              productVariant: "integral",
              servingLabel: "2 fatias (60 g)",
              gramsPerServing: 60,
            },
          ],
      },
    },
  });
  const pending = await repository.getActivePendingOperation(userId, now);
  if (!pending) throw new Error("Pending identity operation was not created");
  return pending;
}

describe("#1054 — continuação de identidade na adição a refeição existente", () => {
  it("aplica a variante somente ao item pendente e preserva o alvo exato", async () => {
    const pending = await createPending();

    const result = await resolveWhatsappMealIntentRegistrationDetailsText({
      userId,
      pendingOperation: pending,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 1000),
      userTimezone: "UTC",
    });

    expect(result?.action).toBe("meal_item_added");
    expect(boundary.handleAddition).toHaveBeenCalledOnce();
    expect(boundary.handleAddition).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        mealLabel: "Café da manhã",
        date: now,
        items: [
          expect.objectContaining({
            foodName: "Leite integral",
            quantity: 50,
            unit: "ml",
          }),
          expect.objectContaining({
            foodName: "Pão de forma Panco Premium",
            brand: "Panco",
            quantity: 2,
            unit: "fatia",
          }),
        ],
      }),
      "America/Sao_Paulo",
      expect.objectContaining({
        originalText: "adicionar 2 fatias de pão de forma Panco ao café da manhã",
        messageId: "wamid-addition-1054",
        expectedMealId: 1054,
        expectedMealLabel: "Café da manhã",
        expectedOccurredAt: now.toISOString(),
        resolvedItems: [expect.objectContaining({
          foodName: "Leite integral",
          estimatedGrams: 50,
        })],
      }),
    );

    expect(await resolveWhatsappMealIntentRegistrationDetailsText({
      userId,
      pendingOperation: pending,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 2000),
      userTimezone: "UTC",
    })).toBeNull();
    expect(boundary.handleAddition).toHaveBeenCalledOnce();
  });

  it("rejeita resposta de quantidade sem consumir a pendência de identidade", async () => {
    const pending = await createPending();

    const result = await resolveWhatsappMealIntentRegistrationDetailsText({
      userId,
      pendingOperation: pending,
      text: "50 g",
      receivedAt: new Date(now.getTime() + 1000),
      userTimezone: "UTC",
    });

    expect(result).toMatchObject({
      action: "clarification_needed",
      reply: "Qual variante Panco você quis registrar?",
    });
    expect(boundary.handleAddition).not.toHaveBeenCalled();
    expect((await repository.getActivePendingOperation(userId, now))?.id).toBe(pending.id);
  });

  it("não permite que outro usuário consuma a continuação", async () => {
    const pending = await createPending();

    expect(await resolveWhatsappMealIntentRegistrationDetailsText({
      userId: userId + 100000,
      pendingOperation: pending,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 1000),
      userTimezone: "UTC",
    })).toBeNull();
    expect(boundary.handleAddition).not.toHaveBeenCalled();
    expect((await repository.getActivePendingOperation(userId, now))?.id).toBe(pending.id);
  });
});
