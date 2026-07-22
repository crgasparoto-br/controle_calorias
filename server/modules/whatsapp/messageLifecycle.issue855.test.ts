import { describe, expect, it, vi } from "vitest";
import {
  beginInboundMessage,
  getCurrentInboundExternalMessageId,
  withMessageLifecycleService,
} from "./messageLifecycle";

function createLifecycleService(options: { failBegin?: boolean } = {}) {
  let nextMessageId = 1;
  return {
    beginInboundMessage: vi.fn(async () => options.failBegin
      ? null
      : {
          conversationId: 1,
          messageId: nextMessageId++,
          wasNewInsert: true,
        }),
    claimMessageForProcessing: vi.fn(async () => true),
    wasMessageAlreadyProcessed: vi.fn(async () => false),
    recordOutboundReply: vi.fn(async () => undefined),
    recordDomainLink: vi.fn(async () => undefined),
    markMessageProcessed: vi.fn(async () => undefined),
    enrichInboundMessage: vi.fn(async () => true),
  } as any;
}

describe("message lifecycle correlation for issue #855", () => {
  it("expõe o ID externo corrente e não o reutiliza no próximo inbound sem ID", async () => {
    await withMessageLifecycleService(createLifecycleService(), async () => {
      await beginInboundMessage({
        userId: 42,
        whatsappConnectionId: null,
        phoneNumber: "5515999999999",
        externalMessageId: "wamid.first.855",
        contentType: "text",
        text: "1 iogurte natural",
        occurredAt: new Date("2026-07-21T20:00:00.000Z"),
      });
      expect(getCurrentInboundExternalMessageId()).toBe("wamid.first.855");

      await beginInboundMessage({
        userId: 42,
        whatsappConnectionId: null,
        phoneNumber: "5515999999999",
        contentType: "text",
        text: "1 banana",
        occurredAt: new Date("2026-07-21T20:01:00.000Z"),
      });
      expect(getCurrentInboundExternalMessageId()).toBeNull();
    });
  });

  it("mantém o ID externo disponível mesmo quando o repositório não cria o handle", async () => {
    await withMessageLifecycleService(createLifecycleService({ failBegin: true }), async () => {
      const handle = await beginInboundMessage({
        userId: 42,
        whatsappConnectionId: null,
        phoneNumber: "5515999999999",
        externalMessageId: "wamid.persistence-failed.855",
        contentType: "audio",
        transcript: "1 iogurte natual desnatado",
        occurredAt: new Date("2026-07-21T20:02:00.000Z"),
      });
      expect(handle).toBeNull();
      expect(getCurrentInboundExternalMessageId()).toBe("wamid.persistence-failed.855");
    });
  });
});
