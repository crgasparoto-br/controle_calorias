import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappIdempotencyForTests,
  buildWhatsappDuplicateInboundResponse,
  checkWhatsappInboundIdempotency,
} from "./idempotencyGuard";

describe("whatsapp idempotency guard", () => {
  beforeEach(() => {
    __resetWhatsappIdempotencyForTests();
  });

  it("bloqueia retry tecnico do mesmo messageId", () => {
    const receivedAt = new Date("2026-06-14T12:00:00.000Z");
    const first = checkWhatsappInboundIdempotency({ userId: 42, messageId: "wamid.1", text: "1 banana", receivedAt });
    const second = checkWhatsappInboundIdempotency({ userId: 42, messageId: "wamid.1", text: "1 banana", receivedAt: new Date(receivedAt.getTime() + 1000) });

    expect(first).toEqual(expect.objectContaining({ duplicate: false, kind: "new" }));
    expect(second).toEqual(expect.objectContaining({ duplicate: true, kind: "technical_retry" }));
    expect(buildWhatsappDuplicateInboundResponse(second)).toEqual(expect.objectContaining({
      action: "duplicate_message_ignored",
      eventType: "whatsapp.idempotency.duplicate_ignored",
    }));
  });

  it("bloqueia texto identico em janela curta quando nao ha messageId", () => {
    const receivedAt = new Date("2026-06-14T12:00:00.000Z");
    checkWhatsappInboundIdempotency({ userId: 42, text: "Comi 1 banana", receivedAt });

    const duplicate = checkWhatsappInboundIdempotency({
      userId: 42,
      text: " comi   1 banana ",
      receivedAt: new Date(receivedAt.getTime() + 30_000),
    });

    expect(duplicate).toEqual(expect.objectContaining({
      duplicate: true,
      kind: "short_window_text_duplicate",
    }));
  });

  it("permite repetir texto quando usuario confirma duplicidade intencional", () => {
    const receivedAt = new Date("2026-06-14T12:00:00.000Z");
    checkWhatsappInboundIdempotency({ userId: 42, text: "Comi 1 banana", receivedAt });

    const repeated = checkWhatsappInboundIdempotency({
      userId: 42,
      text: "Comi 1 banana",
      allowIntentionalDuplicate: true,
      receivedAt: new Date(receivedAt.getTime() + 30_000),
    });

    expect(repeated).toEqual(expect.objectContaining({ duplicate: false, kind: "new" }));
  });

  it("permite mesmo texto fora da janela curta", () => {
    const receivedAt = new Date("2026-06-14T12:00:00.000Z");
    checkWhatsappInboundIdempotency({ userId: 42, text: "Comi 1 banana", receivedAt });

    const later = checkWhatsappInboundIdempotency({
      userId: 42,
      text: "Comi 1 banana",
      receivedAt: new Date(receivedAt.getTime() + 3 * 60_000),
    });

    expect(later).toEqual(expect.objectContaining({ duplicate: false, kind: "new" }));
  });
});
