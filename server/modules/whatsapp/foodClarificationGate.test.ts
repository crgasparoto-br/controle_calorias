import { beforeEach, describe, expect, it, vi } from "vitest";

const getActivePendingOperationMock = vi.fn();
const createPendingOperationMock = vi.fn();
const handleWhatsappFoodClarificationMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => ({
    getActivePendingOperation: getActivePendingOperationMock,
    createPendingOperation: createPendingOperationMock,
    supersedePendingOperation: vi.fn(),
    cancelPendingOperation: vi.fn(),
    claimPendingOperation: vi.fn(),
  })),
}));

vi.mock("./foodClarification", () => ({
  PENDING_FOOD_CLARIFICATION_TYPE: "food_registration_clarification",
  handleWhatsappFoodClarification: handleWhatsappFoodClarificationMock,
  isPendingFoodClarificationTarget: vi.fn(() => false),
  isExpectedWhatsappFoodClarificationAction: vi.fn(() => false),
}));

const { resolvePendingWhatsappFoodClarification } = await import("./foodClarificationGate");

describe("resolvePendingWhatsappFoodClarification", () => {
  beforeEach(() => {
    getActivePendingOperationMock.mockReset();
    createPendingOperationMock.mockReset();
    handleWhatsappFoodClarificationMock.mockReset();
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
    handleWhatsappFoodClarificationMock.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "pergunta",
      eventType: "whatsapp.food_clarification.requested",
      detail: "teste",
    });
  });

  it("resolve pendência alimentar ativa antes do restante do pipeline", async () => {
    getActivePendingOperationMock.mockResolvedValue({ type: "food_registration_clarification" });

    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "170 g",
      userTimezone: "America/Sao_Paulo",
    });

    expect(handleWhatsappFoodClarificationMock).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({ action: "food_clarification_requested" }));
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

    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "sim",
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.interaction.unregistered_pending_blocked",
      data: expect.objectContaining({ fallbackBlocked: true }),
    }));
    expect(handleWhatsappFoodClarificationMock).not.toHaveBeenCalled();
  });
});
