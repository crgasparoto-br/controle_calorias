import { beforeEach, describe, expect, it, vi } from "vitest";

const getActivePendingOperationMock = vi.fn();
const handleWhatsappFoodClarificationMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => ({
    getActivePendingOperation: getActivePendingOperationMock,
  })),
}));

vi.mock("./foodClarification", () => ({
  PENDING_FOOD_CLARIFICATION_TYPE: "food_registration_clarification",
  handleWhatsappFoodClarification: handleWhatsappFoodClarificationMock,
}));

const { resolvePendingWhatsappFoodClarification } = await import("./foodClarificationGate");

describe("resolvePendingWhatsappFoodClarification", () => {
  beforeEach(() => {
    getActivePendingOperationMock.mockReset();
    handleWhatsappFoodClarificationMock.mockReset();
    getActivePendingOperationMock.mockResolvedValue(null);
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
  });

  it("bloqueia comando isolado quando não existe outra pendência", async () => {
    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "registrar",
      userTimezone: "America/Sao_Paulo",
    });

    expect(handleWhatsappFoodClarificationMock).toHaveBeenCalledOnce();
    expect(result).not.toBeNull();
  });

  it("não captura resposta curta pertencente a outra pendência", async () => {
    getActivePendingOperationMock.mockResolvedValue({ type: "delete_confirmation" });

    const result = await resolvePendingWhatsappFoodClarification({
      userId: 42,
      text: "sim",
      userTimezone: "America/Sao_Paulo",
    });

    expect(result).toBeNull();
    expect(handleWhatsappFoodClarificationMock).not.toHaveBeenCalled();
  });
});
