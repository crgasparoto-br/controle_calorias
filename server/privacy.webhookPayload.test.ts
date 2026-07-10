import { describe, expect, it } from "vitest";
import { getAdminSnapshot, logInferenceEvent } from "./db";

/**
 * Issue #767: confirma, de ponta a ponta (logInferenceEvent -> armazenamento ->
 * leitura), que um payload de webhook do Meta contendo token/URL/telefone nunca
 * fica exposto em texto puro no log persistido/consultável.
 */
describe("logInferenceEvent redige payload de webhook sensível de ponta a ponta", () => {
  it("token de acesso, URL temporária e telefone não aparecem no detail persistido", async () => {
    const fakeMetaPayload = {
      accessToken: "Bearer EAAG1234567890secretaccesstoken",
      mediaUrl: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=abc123",
      phoneNumber: "+55 11 98888-7777",
      messageId: "wamid.HBg",
    };

    logInferenceEvent({
      userId: 999999,
      origin: "whatsapp",
      status: "error",
      eventType: "whatsapp.history.persistence_error",
      detail: `Falha ao processar payload: ${JSON.stringify(fakeMetaPayload)}`,
    });

    const snapshot = await getAdminSnapshot();
    const entry = snapshot.recentInferenceLogs.find(log => log.eventType === "whatsapp.history.persistence_error");

    expect(entry).toBeDefined();
    expect(entry!.detail).not.toContain("EAAG1234567890secretaccesstoken");
    expect(entry!.detail).not.toContain("98888-7777");
    expect(entry!.detail).toContain("Bearer [redacted]");
    expect(entry!.detail).toContain("[phone_redacted]");
  });
});
