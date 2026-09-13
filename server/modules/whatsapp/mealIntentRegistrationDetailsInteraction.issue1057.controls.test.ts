import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngine";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import type { CountableRegistrationContinuation } from "./countableFoodRegistrationGate";

const boundary = vi.hoisted(() => ({
  register: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: async () => null,
  logPersistenceWarning: vi.fn(),
}));
vi.mock("./confirmedMealRegistration", () => ({
  executeConfirmedWhatsAppMealRegistration: (...args: unknown[]) =>
    boundary.register(...args),
}));

import { resolvePendingWhatsappFoodClarification } from "./foodClarificationGate";
import {
  createWhatsappMealIntentRegistrationDetailsInteraction,
  isPendingMealIntentRegistrationDetails,
} from "./mealIntentRegistrationDetailsInteraction";

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});
const now = new Date("2026-09-09T22:00:00Z");
let userId = 105790;

const siblingSnapshot: CountableRegistrationContinuation["resolvedSegments"] = [
  {
    segmentIndex: 0,
    processed: {
      detectedMealLabel: "Lanche",
      sourceText: "50ml leite integral",
      items: [],
    } as unknown as MealProcessingResult,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  userId += 1;
  boundary.register.mockResolvedValue({
    status: "registered",
    result: {
      handled: true,
      action: "meal_registered",
      reply: "Refeição registrada.",
      eventType: "whatsapp.meal_registered",
      detail: "Persistência concluída uma vez.",
      data: {},
    },
  });
});

async function createPending() {
  const registrationSegments = [
    "50 ml de leite integral",
    "2 fatias de pão de forma Panco",
    "35 g de requeijão catupiry",
  ];
  await createWhatsappMealIntentRegistrationDetailsInteraction({
    userId,
    originalText:
      "50ml leite integral, 2 fatias de pão de forma panco, 35g de requeijão catupiry",
    registrationText: registrationSegments.join("\n"),
    inboundMessageId: `wamid-1057-controls-${userId}`,
    prompt: "Qual variante de pão de forma Panco você quis registrar?",
    receivedAt: now,
    countableContext: {
      registrationSegments,
      itemIndex: 1,
      resolvedSegments: siblingSnapshot,
      occurredAt: now.toISOString(),
      userTimezone: "America/Sao_Paulo",
      clarification: {
        originalText: "pão de forma panco",
        foodName: "Pão de forma Panco",
        brand: "Panco",
        clarificationReason: "brand_variant_unresolved",
        alternatives: [],
      } as unknown as CountableRegistrationContinuation["clarification"],
    },
  });
  const pending = await repository.getActivePendingOperation(userId, now);
  if (!pending) throw new Error("Pending registration details was not created");
  return pending;
}

describe("#1057 — controles persistentes da retomada de identidade", () => {
  it("recria uma sucessora persistida antes de uma nova clarificação", async () => {
    const pending = await createPending();
    boundary.register.mockResolvedValueOnce({
      status: "safe_to_retry",
      prompt: "Qual sabor exato do pão de forma Panco Premium?",
      detail: "Nova clarificação necessária antes de qualquer mutação.",
    });

    const result = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
      messageId: "reply-1057-reclarify",
    });

    expect(result).toMatchObject({
      action: "clarification_needed",
      eventType: "whatsapp.meal_intent_decision.registration_details_requested",
    });
    expect(boundary.register).toHaveBeenCalledOnce();
    expect((await repository.getPendingOperationById(pending.id))?.state).toBe(
      "consumed",
    );

    const successor = await repository.getActivePendingOperation(
      userId,
      new Date(now.getTime() + 1_000),
    );
    expect(successor?.id).not.toBe(pending.id);
    expect(isPendingMealIntentRegistrationDetails(successor?.target)).toBe(true);
    if (!successor || !isPendingMealIntentRegistrationDetails(successor.target)) {
      throw new Error("Successor registration details was not recreated");
    }
    expect(successor.target.registrationText).toContain(
      "2 fatias de pão de forma Panco Premium",
    );
    expect(successor.target.inboundMessageId).toBe(
      `wamid-1057-controls-${userId}`,
    );
    expect(successor.target.countableContext?.registrationSegments[1]).toBe(
      "2 fatias de pão de forma Panco Premium",
    );
    expect(successor.target.countableContext?.resolvedSegments).toEqual(
      siblingSnapshot,
    );
  });

  it("CANCELAR encerra sem registrar e impede retomada posterior", async () => {
    const pending = await createPending();
    const cancelled = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "CANCELAR",
      receivedAt: new Date(now.getTime() + 1_000),
      userTimezone: "America/Sao_Paulo",
      messageId: "reply-1057-cancel",
    });

    expect(cancelled).toMatchObject({
      action: "meal_intent_decision_cancelled",
      eventType: "whatsapp.meal_intent_decision.registration_details_cancelled",
    });
    expect(boundary.register).not.toHaveBeenCalled();
    expect((await repository.getPendingOperationById(pending.id))?.state).toBe(
      "consumed",
    );
    expect(
      await repository.getActivePendingOperation(
        userId,
        new Date(now.getTime() + 1_000),
      ),
    ).toBeNull();

    const staleReply = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Premium",
      receivedAt: new Date(now.getTime() + 2_000),
      userTimezone: "America/Sao_Paulo",
      messageId: "reply-1057-after-cancel",
    });
    expect(staleReply?.eventType).toBe(
      "whatsapp.meal_intent_decision.registration_details_unavailable",
    );
    expect(boundary.register).not.toHaveBeenCalled();
  });

  it("duas respostas concorrentes produzem no máximo um registro", async () => {
    await createPending();
    const receivedAt = new Date(now.getTime() + 1_000);

    const results = await Promise.all([
      resolvePendingWhatsappFoodClarification({
        userId,
        text: "Premium",
        receivedAt,
        userTimezone: "America/Sao_Paulo",
        messageId: "reply-1057-race-a",
      }),
      resolvePendingWhatsappFoodClarification({
        userId,
        text: "Premium",
        receivedAt,
        userTimezone: "America/Sao_Paulo",
        messageId: "reply-1057-race-b",
      }),
    ]);

    expect(
      results.filter((result) => result?.action === "meal_registered"),
    ).toHaveLength(1);
    expect(boundary.register).toHaveBeenCalledOnce();
    expect((await repository.getLatestPendingOperation(userId))?.state).toBe(
      "consumed",
    );
  });
});
