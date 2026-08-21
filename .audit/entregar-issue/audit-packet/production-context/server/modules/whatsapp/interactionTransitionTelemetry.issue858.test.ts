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
const { buildWhatsAppCallbackId } = await import("./interactiveCallback");
const {
  INTENT_CLARIFICATION_ACTIONS,
  PENDING_INTENT_CLARIFICATION_TYPE,
} = await import("./intentClarificationInteraction");
const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});

async function createSource(userId: number, receivedAt: Date) {
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
  return source;
}

function expectTransitionTelemetry(
  data: Record<string, unknown> | undefined,
  sourceId: number,
  downstreamId: number | undefined,
) {
  expect(data).toEqual(expect.objectContaining({
    pendingOperationId: downstreamId,
    pendingType: "food_registration_clarification",
    interactionId: "food_clarification.selection",
    interactionLifecycle: "created",
    sourcePendingOperationId: sourceId,
    sourcePendingType: PENDING_INTENT_CLARIFICATION_TYPE,
    sourceInteractionId: "intent_clarification.generic",
    sourceInteractionLifecycle: "consumed",
  }));
}

describe("telemetria de transição entre interações da issue #858", () => {
  it("preserva a nova pendência alimentar e registra a clarificação textual como origem consumida", async () => {
    const userId = 85_831;
    const receivedAt = new Date("2026-07-22T01:00:00.000Z");
    const source = await createSource(userId, receivedAt);

    const result = await resolvePendingWhatsappFoodClarification({
      userId,
      text: "Registrar alimento",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid-transition-858",
    });
    const downstream = await repository.getActivePendingOperation(userId, receivedAt);

    expect(downstream?.type).toBe("food_registration_clarification");
    expectTransitionTelemetry(result?.data, source.id, downstream?.id);
    expect((await repository.getPendingOperationById(source.id))?.state).toBe("consumed");
  });

  it("preserva a nova pendência alimentar e registra o callback como origem consumida", async () => {
    const userId = 85_832;
    const receivedAt = new Date("2026-07-22T01:00:00.000Z");
    const source = await createSource(userId, receivedAt);

    const result = await resolveWhatsAppPrecedenceGate({
      userId,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      interactiveReplyId: buildWhatsAppCallbackId(source.id, "register_food"),
    });
    const downstream = await repository.getActivePendingOperation(userId, receivedAt);

    expect(result.step).toBe("interactive_callback");
    if (result.step !== "interactive_callback") throw new Error("callback não resolvido");
    expect(downstream?.type).toBe("food_registration_clarification");
    expectTransitionTelemetry(result.result.data, source.id, downstream?.id);
    expect(result.result.data).toEqual(expect.objectContaining({ callbackBlocked: false }));
    expect((await repository.getPendingOperationById(source.id))?.state).toBe("consumed");
  });
});
