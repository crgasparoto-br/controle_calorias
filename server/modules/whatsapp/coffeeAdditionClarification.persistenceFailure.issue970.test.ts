import { describe, expect, it, vi } from "vitest";

const createPendingOperationMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => ({
    createPendingOperation: createPendingOperationMock,
  })),
}));

vi.mock("./pendingOperationPrecedence", () => ({
  supersedeActiveWhatsappPendingOperations: vi.fn(async () => true),
}));

const { createWhatsappCoffeeAdditionClarification } = await import("./coffeeAdditionClarification");

describe("issue #970 - falha fechada ao persistir clarificação parcial", () => {
  it("não envia uma pergunta retomável quando a persistência está indisponível", async () => {
    const result = await createWhatsappCoffeeAdditionClarification({
      userId: 97009,
      originalText: "Adicionar café sem açúcar no café da manhã",
      addition: { cups: 0, unit: null, mealLabel: "café da manhã" },
      receivedAt: new Date("2026-08-12T12:00:00.000Z"),
    });

    expect(createPendingOperationMock).toHaveBeenCalledOnce();
    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.coffee_addition_clarification.persistence_unavailable",
      data: expect.objectContaining({
        fallbackBlocked: true,
        fallbackBlockReason: "persistence_unavailable",
      }),
    }));
    expect(result.reply).toContain("com quantidade e refeição");
    expect(result.reply).not.toContain("Me diga apenas a quantidade");
  });
});
