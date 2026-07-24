import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";
import { createFoodQuantityClarificationService } from "./foodQuantityClarification";

const originalEnv = { ...process.env };

function buildRequest(
  service: ReturnType<typeof createFoodQuantityClarificationService>
) {
  return service.requestCaloricComplementQuantity({
    userId: 903,
    originalFoodText: "1 xícara de café com açúcar",
    operation: {
      kind: "register",
      occurredAt: "2026-07-24T12:00:00.000Z",
    },
    receivedAt: new Date("2026-07-24T12:00:00.000Z"),
    messageId: "wamid-persistence-failure",
  });
}

describe("falha ao persistir clarificação de açúcar", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

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

    const result = await buildRequest(service);

    expect(repository.createPendingOperation).toHaveBeenCalledTimes(1);
    expect(repository.claimPendingOperation).not.toHaveBeenCalled();
    expect(result.action).toBe("food_clarification_blocked");
    expect(result.eventType).toBe(
      "whatsapp.food_clarification.persistence_unavailable"
    );
    expect(result.reply).not.toContain("Informe somente a quantidade de açúcar");
  });

  it("usa o adapter real e bloqueia a pergunta quando o banco está indisponível em produção", async () => {
    process.env.NODE_ENV = "production";
    process.env.ALLOW_MEMORY_PERSISTENCE = "true";
    const onWarning = vi.fn();
    const repository = createDrizzleWhatsAppPendingOperationRepository({
      getDb: async () => null,
      onWarning,
    });
    const service = createFoodQuantityClarificationService({ repository });

    const result = await buildRequest(service);

    expect(result.action).toBe("food_clarification_blocked");
    expect(result.eventType).toBe(
      "whatsapp.food_clarification.persistence_unavailable"
    );
    expect(result.reply).not.toContain("Informe somente a quantidade de açúcar");
    expect(result.data).toBeUndefined();
    expect(onWarning).toHaveBeenCalledWith(
      "WhatsApp pending operation create skipped",
      expect.objectContaining({
        message: expect.stringContaining(
          "memory persistence fallback is disabled"
        ),
      })
    );
  });
});
