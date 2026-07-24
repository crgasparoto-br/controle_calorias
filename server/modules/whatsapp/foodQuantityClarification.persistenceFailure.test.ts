import { describe, expect, it, vi } from "vitest";
import { createFoodQuantityClarificationService } from "./foodQuantityClarification";

describe("falha ao persistir clarificação de açúcar", () => {
  it("não retorna a pergunta funcional nem executa efeito de domínio", async () => {
    const repository = {
      createPendingOperation: vi.fn(async () => null),
      getActivePendingOperation: vi.fn(async () => null),
      getLatestPendingOperation: vi.fn(async () => null),
      getPendingOperationById: vi.fn(async () => null),
      claimPendingOperation: vi.fn(async () => ({ claimed: false })),
      cancelPendingOperation: vi.fn(async () => ({ cancelled: false })),
      supersedePendingOperation: vi.fn(async () => ({ superseded: false })),
      purgeInactiveOperations: vi.fn(async () => 0),
    };
    const service = createFoodQuantityClarificationService({
      repository: repository as any,
    });

    const result = await service.requestCaloricComplementQuantity({
      userId: 903,
      originalFoodText: "1 xícara de café com açúcar",
      operation: {
        kind: "register",
        occurredAt: "2026-07-24T12:00:00.000Z",
      },
      receivedAt: new Date("2026-07-24T12:00:00.000Z"),
      messageId: "wamid-persistence-failure",
    });

    expect(repository.createPendingOperation).toHaveBeenCalledTimes(1);
    expect(repository.claimPendingOperation).not.toHaveBeenCalled();
    expect(result.action).toBe("food_clarification_blocked");
    expect(result.eventType).toBe("whatsapp.food_clarification.persistence_unavailable");
    expect(result.reply).not.toContain("Informe somente a quantidade de açúcar");
  });
});
