import { describe, expect, it, vi } from "vitest";

vi.mock("../../db", async () => {
  const actual = await vi.importActual<typeof import("../../db")>("../../db");
  return {
    ...actual,
    getDb: vi.fn(async () => null),
    logPersistenceWarning: vi.fn(),
  };
});

const { createDrizzleWhatsAppPendingOperationRepository } = await import("../../repositories/whatsappPendingOperationRepository");
const { resolvePendingWhatsappFoodClarification } = await import("./foodClarificationGate");
const {
  INTENT_CLARIFICATION_ACTIONS,
  PENDING_INTENT_CLARIFICATION_TYPE,
} = await import("./intentClarificationInteraction");

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});

describe("telemetria de transição entre interações da issue #858", () => {
  it("preserva a nova pendência alimentar e registra a clarificação genérica como origem consumida", async () => {
    const userId = 85_831;
    const receivedAt = new Date("2026-07-22T01:00:00.000Z");
    const source = await repository.createPendingOperation({
      userId,
      type: PENDING_INTENT_CLARIFICATION_TYPE,
      origin: "intentClarificationInteraction",
      ttlMs: 60_000,
      now: receivedAt,
      target: {
        contractVersion: 1,
        interactionId: "intent_clarification.generic",
        kind: "intent_clarification",
        originalText: "1 iorgute natual",
        actions: [...INTENT_CLARIFICATION_ACTIONS],
      },
    });
    if (!source) throw new Error("pendência de origem não criada");

    const result = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Registrar alimento",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid-transition-858",
    });
    const downstream = await repository.getActivePendingOperation(userId, receivedAt);

    expect(downstream?.type).toBe("food_registration_clarification");
    expect(result?.data).toEqual(expect.objectContaining({
      pendingOperationId: downstream?.id,
      pendingType: "food_registration_clarification",
      interactionId: "food_clarification.confirmation",
      interactionLifecycle: "created",
      sourcePendingOperationId: source.id,
      sourcePendingType: PENDING_INTENT_CLARIFICATION_TYPE,
      sourceInteractionId: "intent_clarification.generic",
      sourceInteractionLifecycle: "consumed",
    }));
    expect((await repository.getPendingOperationById(source.id))?.state).toBe("consumed");
  });
});
