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
const {
  buildPendingFoodClarificationTarget,
  PENDING_FOOD_CLARIFICATION_ORIGIN,
  PENDING_FOOD_CLARIFICATION_TYPE,
} = await import("./foodClarificationContract");
const { buildWhatsAppCallbackId } = await import("./interactiveCallback");
const { resolveWhatsAppPrecedenceGate } = await import("./messageRouter");

const repository = createDrizzleWhatsAppPendingOperationRepository({
  getDb: async () => null,
  onWarning: vi.fn(),
});

describe("proteção de callback em interação aberta da issue #858", () => {
  it("rejeita provide_quantity forjado e mantém a pendência ativa", async () => {
    const userId = 85_841;
    const receivedAt = new Date("2026-07-22T01:00:00.000Z");
    const target = buildPendingFoodClarificationTarget({
      request: {
        originalText: "1 iogurte natural",
        originalCandidate: "iogurte natural",
        normalizedCandidate: "iogurte natural",
        normalizationChanged: false,
        count: 1,
      },
      pendingKind: "quantity",
      candidates: [],
      instructionText: "Qual é o peso?",
      messageId: "wamid-open-callback-858",
    });
    const pending = await repository.createPendingOperation({
      userId,
      type: PENDING_FOOD_CLARIFICATION_TYPE,
      origin: PENDING_FOOD_CLARIFICATION_ORIGIN,
      ttlMs: 60_000,
      now: receivedAt,
      target,
    });
    if (!pending) throw new Error("pendência aberta não criada");

    const result = await resolveWhatsAppPrecedenceGate({
      userId,
      receivedAt,
      interactiveReplyId: buildWhatsAppCallbackId(pending.id, "provide_quantity"),
    });

    expect(result.step).toBe("interactive_callback");
    if (result.step !== "interactive_callback") throw new Error("callback não roteado");
    expect(result.result.eventType).toBe("whatsapp.interactive_callback.unavailable");
    expect(result.result.data).toEqual(expect.objectContaining({
      callbackBlocked: true,
      interactionLifecycle: "blocked",
    }));
    expect((await repository.getPendingOperationById(pending.id))?.state).toBe("active");
  });
});
