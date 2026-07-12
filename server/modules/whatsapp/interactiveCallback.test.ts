import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import {
  buildWhatsAppCallbackId,
  claimWhatsAppInteractiveCallback,
  parseWhatsAppCallbackId,
} from "./interactiveCallback";
import { createDrizzleWhatsAppPendingOperationRepository } from "../../repositories/whatsappPendingOperationRepository";

const repository = createDrizzleWhatsAppPendingOperationRepository({ getDb, onWarning: () => {} });

async function createPending(userId: number, type = "delete") {
  const created = await repository.createPendingOperation({
    userId,
    type,
    origin: "test",
    ttlMs: 10 * 60 * 1000,
    target: { mealId: 1 },
  });
  if (!created) throw new Error("failed to create pending operation for test");
  return created;
}

describe("interactiveCallback", () => {
  it("gera um ID opaco que não expõe o pendingOperationId nem a ação em texto plano", () => {
    const id = buildWhatsAppCallbackId(42, "confirm");
    expect(id).not.toContain("42");
    expect(id).not.toContain("confirm");
  });

  it("faz round-trip de parse do ID gerado", () => {
    const id = buildWhatsAppCallbackId(42, "select:2");
    expect(parseWhatsAppCallbackId(id)).toEqual({ pendingOperationId: 42, action: "select:2" });
  });

  it("rejeita um ID adulterado (assinatura não confere)", () => {
    const id = buildWhatsAppCallbackId(42, "confirm");
    const tampered = `${id.slice(0, -1)}${id.at(-1) === "a" ? "b" : "a"}`;
    expect(parseWhatsAppCallbackId(tampered)).toBeNull();
  });

  it("rejeita um ID mal formado", () => {
    expect(parseWhatsAppCallbackId("garbage")).toBeNull();
    expect(parseWhatsAppCallbackId("")).toBeNull();
  });

  describe("claimWhatsAppInteractiveCallback", () => {
    beforeEach(() => {
      // usa o fallback em memória do repositório de pendências (sem DATABASE_URL neste ambiente de teste)
    });

    it("retorna invalid para um callback que não corresponde ao formato assinado", async () => {
      const result = await claimWhatsAppInteractiveCallback(1, "not-a-real-callback");
      expect(result).toEqual({ status: "invalid" });
    });

    it("reivindica com sucesso um callback válido pertencente ao usuário e consome a pendência uma única vez", async () => {
      const userId = 9_001;
      const pending = await createPending(userId);
      const callbackId = buildWhatsAppCallbackId(pending.id, "confirm");

      const first = await claimWhatsAppInteractiveCallback(userId, callbackId);
      expect(first.status).toBe("claimed");
      if (first.status !== "claimed") throw new Error("expected claimed");
      expect(first.action).toBe("confirm");
      expect(first.pendingOperation.id).toBe(pending.id);

      // Clique duplo / reentrega do mesmo callback: a segunda tentativa não pode repetir o consumo.
      const second = await claimWhatsAppInteractiveCallback(userId, callbackId);
      expect(second.status).toBe("unavailable");
    });

    it("retorna unavailable quando o callback pertence a outro usuário (isolamento entre contas)", async () => {
      const owner = 9_002;
      const attacker = 9_003;
      const pending = await createPending(owner);
      const callbackId = buildWhatsAppCallbackId(pending.id, "confirm");

      const result = await claimWhatsAppInteractiveCallback(attacker, callbackId);
      expect(result.status).toBe("unavailable");

      // A pendência do dono legítimo continua ativa e consumível normalmente.
      const legitimate = await claimWhatsAppInteractiveCallback(owner, callbackId);
      expect(legitimate.status).toBe("claimed");
    });

    it("retorna unavailable para uma pendência expirada", async () => {
      const userId = 9_004;
      const pending = await createPending(userId);
      const callbackId = buildWhatsAppCallbackId(pending.id, "confirm");
      const farFuture = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const result = await claimWhatsAppInteractiveCallback(userId, callbackId, farFuture);
      expect(result.status).toBe("unavailable");
    });

    it("retorna unavailable para uma pendência que não existe mais (ID inexistente)", async () => {
      const callbackId = buildWhatsAppCallbackId(999_999_999, "confirm");
      const result = await claimWhatsAppInteractiveCallback(1, callbackId);
      expect(result.status).toBe("unavailable");
    });

    it("duas corridas concorrentes pelo mesmo callback resultam em exatamente um claim bem-sucedido", async () => {
      const userId = 9_005;
      const pending = await createPending(userId);
      const callbackId = buildWhatsAppCallbackId(pending.id, "confirm");

      const [a, b] = await Promise.all([
        claimWhatsAppInteractiveCallback(userId, callbackId),
        claimWhatsAppInteractiveCallback(userId, callbackId),
      ]);
      const claimedCount = [a, b].filter(result => result.status === "claimed").length;
      expect(claimedCount).toBe(1);
    });
  });
});
