import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetWhatsappInboundIdempotencyForTests,
  buildWhatsappDuplicateInboundResult,
  evaluateWhatsappInboundIdempotency,
} from "./inboundIdempotencyGuard";

describe("evaluateWhatsappInboundIdempotency", () => {
  beforeEach(() => {
    __resetWhatsappInboundIdempotencyForTests();
  });

  it("bloqueia retry tecnico com o mesmo messageId", () => {
    const first = evaluateWhatsappInboundIdempotency({
      userId: 42,
      messageId: "wamid-1",
      text: "almocei arroz e feijao",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    const retry = evaluateWhatsappInboundIdempotency({
      userId: 42,
      messageId: "wamid-1",
      text: "almocei arroz e feijao",
      receivedAt: new Date("2026-06-15T12:00:05.000Z"),
    });

    expect(first.shouldProcess).toBe(true);
    expect(retry).toEqual(expect.objectContaining({
      shouldProcess: false,
      duplicateKind: "message_id_retry",
      eventType: "whatsapp.idempotency.message_retry_ignored",
    }));
    expect(buildWhatsappDuplicateInboundResult(retry)).toEqual(expect.objectContaining({
      action: "duplicate_inbound_message_ignored",
      reply: expect.stringContaining("não vou processar de novo"),
    }));
  });

  it("bloqueia reenvio textual dentro da janela curta", () => {
    evaluateWhatsappInboundIdempotency({
      userId: 42,
      text: "Registre 100g de arroz",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    const duplicate = evaluateWhatsappInboundIdempotency({
      userId: 42,
      text: "registre 100 g de arroz",
      receivedAt: new Date("2026-06-15T12:00:30.000Z"),
    });

    expect(duplicate).toEqual(expect.objectContaining({
      shouldProcess: false,
      duplicateKind: "short_window_text_duplicate",
      eventType: "whatsapp.idempotency.short_window_duplicate_ignored",
    }));
  });

  it("libera mensagem igual fora da janela curta", () => {
    evaluateWhatsappInboundIdempotency({
      userId: 42,
      text: "banana",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
      duplicateWindowMs: 60_000,
    });
    const later = evaluateWhatsappInboundIdempotency({
      userId: 42,
      text: "banana",
      receivedAt: new Date("2026-06-15T12:02:00.000Z"),
      duplicateWindowMs: 60_000,
    });

    expect(later.shouldProcess).toBe(true);
    expect(later.duplicateKind).toBeNull();
  });

  it("libera repeticao textual quando ha intencao clara de novo registro", () => {
    evaluateWhatsappInboundIdempotency({
      userId: 42,
      text: "100g arroz de novo",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    const intentional = evaluateWhatsappInboundIdempotency({
      userId: 42,
      text: "100g arroz de novo",
      receivedAt: new Date("2026-06-15T12:00:20.000Z"),
    });

    expect(intentional).toEqual(expect.objectContaining({
      shouldProcess: true,
      duplicateKind: "intentional_repeat",
      eventType: "whatsapp.idempotency.intentional_repeat_allowed",
    }));
  });

  it("isola duplicidade por usuario", () => {
    evaluateWhatsappInboundIdempotency({
      userId: 42,
      text: "cafe com leite",
      receivedAt: new Date("2026-06-15T12:00:00.000Z"),
    });
    const otherUser = evaluateWhatsappInboundIdempotency({
      userId: 99,
      text: "cafe com leite",
      receivedAt: new Date("2026-06-15T12:00:10.000Z"),
    });

    expect(otherUser.shouldProcess).toBe(true);
  });
});
