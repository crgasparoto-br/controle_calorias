import { describe, expect, it } from "vitest";
import {
  fingerprintWhatsAppMessageId,
  resolveWhatsAppWebhookCorrelation,
} from "./webhookCorrelation";

describe("WhatsApp webhook correlation", () => {
  it("gera fingerprint determinístico sem expor o message.id bruto", () => {
    const messageId = "wamid.1061.restart";
    const first = fingerprintWhatsAppMessageId(messageId);
    const second = fingerprintWhatsAppMessageId(messageId);

    expect(first).toBe("1a89324777d8aa820c28");
    expect(second).toBe(first);
    expect(first).not.toContain(messageId);
  });

  it("correlaciona somente mensagens reais do payload e deduplica IDs repetidos", () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [
              { id: "wamid.1061.restart", from: "5511999999999", type: "text" },
              { id: "wamid.1061.restart", from: "5511999999999", type: "text" },
              { id: "wamid.1061.other", from: "5511888888888", type: "text" },
            ],
          },
        }],
      }],
    };

    const correlation = resolveWhatsAppWebhookCorrelation(payload);

    expect(correlation.messageCount).toBe(3);
    expect(correlation.messageFingerprints).toHaveLength(2);
    expect(correlation.messageFingerprints).toContain(
      fingerprintWhatsAppMessageId("wamid.1061.restart")
    );
    expect(correlation.messageFingerprints).toContain(
      fingerprintWhatsAppMessageId("wamid.1061.other")
    );
    expect(JSON.stringify(correlation)).not.toContain("wamid.");
    expect(JSON.stringify(correlation)).not.toContain("5511");
  });

  it("não inventa correlação de mensagem para callbacks sem messages", () => {
    expect(resolveWhatsAppWebhookCorrelation({ entry: [{ changes: [{ value: {} }] }] }))
      .toEqual({ messageCount: 0, messageFingerprints: [] });
  });
});
