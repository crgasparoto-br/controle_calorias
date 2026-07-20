import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getUserWhatsappConnection: vi.fn(),
  logPersistenceWarning: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  getUserWhatsappConnection: mocks.getUserWhatsappConnection,
  logPersistenceWarning: mocks.logPersistenceWarning,
}));
vi.mock("../whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppStandaloneLogicalReply: mocks.send,
}));

import {
  deliverProfessionalMessage,
  tryAssociateProfessionalWhatsappResponse,
} from "./messageService";

function messageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "f3c9b83a-7574-4ddf-a291-964b420393e2",
    conversationId: "conversation-1",
    authorizationId: "authorization-1",
    professionalUserId: 10,
    patientUserId: 20,
    origin: "professional",
    messageType: "record_request",
    content: "Registre sua refeição de hoje.",
    responseCode: "RESP-A1B2C3D4",
    authorName: "Nutricionista",
    ...overrides,
  };
}

describe("professional message service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserWhatsappConnection.mockResolvedValue({
      status: "active",
      phoneNumber: "5511999999999",
    });
    mocks.send.mockResolvedValue({ result: { primaryOk: true } });
  });

  it("claims a logical message once and does not duplicate delivery on a concurrent retry", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[messageRow()]])
      .mockResolvedValueOnce([[{ number: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }]);
    const db = {
      execute,
      transaction: (callback: (tx: { execute: typeof execute }) => unknown) =>
        callback({ execute }),
    };
    mocks.getDb.mockResolvedValue(db);

    await expect(deliverProfessionalMessage(messageRow().id as string, 10)).resolves.toEqual({ status: "sent" });
    await expect(deliverProfessionalMessage(messageRow().id as string, 10)).resolves.toEqual({ status: "unchanged" });
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("keeps the message failed and records a sanitized channel error", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[messageRow()]])
      .mockResolvedValueOnce([[{ number: 2 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const db = {
      execute,
      transaction: (callback: (tx: { execute: typeof execute }) => unknown) =>
        callback({ execute }),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.send.mockResolvedValue({ result: { primaryOk: false } });

    await expect(deliverProfessionalMessage(messageRow().id as string, 10)).resolves.toEqual({ status: "failed" });
    expect(mocks.logPersistenceWarning).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(7);
  });

  it("associates an explicit response once and absorbs duplicate inbound callbacks", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([[messageRow({ state: "sent" })]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[messageRow({ state: "sent" })]])
      .mockRejectedValueOnce(new Error("duplicate key"));
    mocks.getDb.mockResolvedValue({ execute });
    const input = {
      patientUserId: 20,
      text: "RESP-A1B2C3D4 Já registrei.",
      externalMessageId: "wamid.response-1",
      receivedAt: new Date("2026-07-20T12:00:00Z"),
    };

    await expect(tryAssociateProfessionalWhatsappResponse(input)).resolves.toMatchObject({ eventType: "whatsapp.professional_response.received" });
    await expect(tryAssociateProfessionalWhatsappResponse(input)).resolves.toMatchObject({ eventType: "whatsapp.professional_response.duplicate" });
  });

  it("does not capture ambiguous or ordinary nutrition text", async () => {
    await expect(tryAssociateProfessionalWhatsappResponse({ patientUserId: 20, text: "arroz e feijão", externalMessageId: "ordinary", receivedAt: new Date() })).resolves.toBeNull();
    await expect(tryAssociateProfessionalWhatsappResponse({ patientUserId: 20, text: "RESP-A1B2C3D4 RESP-FFEEDDCC", externalMessageId: "ambiguous", receivedAt: new Date() })).resolves.toBeNull();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
