import { beforeEach, describe, expect, it, vi } from "vitest";

const getActivePendingOperationMock = vi.hoisted(() => vi.fn());
const createPendingOperationMock = vi.hoisted(() => vi.fn());
const supersedePendingOperationMock = vi.hoisted(() => vi.fn());
const handleWhatsappFoodClarificationMock = vi.hoisted(() => vi.fn());
const findWhatsappRegisteredInteractionMock = vi.hoisted(() => vi.fn());
const rebuildWhatsappRegisteredInteractionMock = vi.hoisted(() => vi.fn());
const resolveWhatsappRegisteredTextMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => ({
    getActivePendingOperation: getActivePendingOperationMock,
    createPendingOperation: createPendingOperationMock,
    supersedePendingOperation: supersedePendingOperationMock,
    cancelPendingOperation: vi.fn(),
    claimPendingOperation: vi.fn(),
  })),
}));

vi.mock("./foodClarification", () => ({
  handleWhatsappFoodClarification: handleWhatsappFoodClarificationMock,
}));

vi.mock("./interactionRegistry", () => ({
  findWhatsappRegisteredInteraction: findWhatsappRegisteredInteractionMock,
  rebuildWhatsappRegisteredInteraction: rebuildWhatsappRegisteredInteractionMock,
  resolveWhatsappRegisteredText: resolveWhatsappRegisteredTextMock,
}));

const { resolvePendingWhatsappFoodClarification } = await import("./foodClarificationGate");

describe("resolvePendingWhatsappFoodClarification", () => {
  beforeEach(() => {
    getActivePendingOperationMock.mockReset();
    createPendingOperationMock.mockReset();
    supersedePendingOperationMock.mockReset();
    handleWhatsappFoodClarificationMock.mockReset();
    findWhatsappRegisteredInteractionMock.mockReset();
    rebuildWhatsappRegisteredInteractionMock.mockReset();
    resolveWhatsappRegisteredTextMock.mockReset();
    getActivePendingOperationMock.mockResolvedValue(null);
    createPendingOperationMock.mockImplementation(async input => ({
      id: 99,
      userId: input.userId,
      type: input.type,
      origin: input.origin,
      target: input.target,
      state: "active",
      version: 1,
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    supersedePendingOperationMock.mockResolvedValue({ superseded: true });
    handleWhatsappFoodClarificationMock.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "pergunta",
      eventType: "whatsapp.food_clarification.requested",
      detail: "teste",
    });
  });

  it("resolve pendência registrada pelo handler textual da entrada antes do restante do pipeline", async () => {
    const active = {
      id: 7,
      userId: 42,
      type: "food_registration_clarification",
      origin: "foodClarification",
      target: { pendingKind: "quantity" },
      state: "active",
      version: 1,
    };
    const interaction = {
      id: "food_clarification.quantity",
      classifyText: vi.fn(() => "resolve"),
    };
    getActivePendingOperationMock.mockResolvedValue(active);
    findWhatsappRegisteredInteractionMock.mockReturnValue(interaction);
    resolveWhatsappRegisteredTextMock.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "pergunta",
      eventType: "whatsapp.food_clarification.requested",
      detail: "teste",
    });

    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "170 g",
      userTimezone: "America/Sao_Paulo",
    });

    expect(interaction.classifyText).toHaveBeenCalledWith(active.target, "170 g");
    expect(resolveWhatsappRegisteredTextMock).toHaveBeenCalledWith(
      interaction,
      expect.objectContaining({ pendingOperation: active, text: "170 g" }),
    );
    expect(result).toEqual(expect.objectContaining({ action: "food_clarification_requested" }));
    expect(handleWhatsappFoodClarificationMock).not.toHaveBeenCalled();
  });

  it("não cria nova pendência antes dos parsers especializados", async () => {
    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "1 café lor",
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toBeNull();
    expect(handleWhatsappFoodClarificationMock).not.toHaveBeenCalled();
    expect(createPendingOperationMock).not.toHaveBeenCalled();
  });

  it("transforma comando operacional isolado em clarificação genérica interativa", async () => {
    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "registrar",
      userTimezone: "America/Sao_Paulo",
    });

    expect(createPendingOperationMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      type: "intent_clarification",
    }));
    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent_clarification.requested",
      interactiveReply: expect.objectContaining({ kind: "functional" }),
    }));
    expect(handleWhatsappFoodClarificationMock).not.toHaveBeenCalled();
  });

  it("falha de forma fechada quando aparece tipo de pendência não registrado", async () => {
    getActivePendingOperationMock.mockResolvedValue({
      id: 7,
      userId: 42,
      type: "some_future_type",
      origin: "futureHandler",
      target: {},
      state: "active",
      version: 1,
    });
    findWhatsappRegisteredInteractionMock.mockReturnValue(null);

    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "sim",
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.interaction.unregistered_pending_blocked",
      data: expect.objectContaining({
        fallbackBlocked: true,
        interactionLifecycle: "blocked",
      }),
    }));
    expect(resolveWhatsappRegisteredTextMock).not.toHaveBeenCalled();
    expect(handleWhatsappFoodClarificationMock).not.toHaveBeenCalled();
  });
});
