import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getUserWhatsappConnection: vi.fn(),
  send: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  getUserWhatsappConnection: mocks.getUserWhatsappConnection,
  logPersistenceWarning: mocks.logPersistenceWarning,
}));
vi.mock("../whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppStandaloneLogicalReply: mocks.send,
}));

import { createProfessionalMessage } from "./messageService";
import type { ProfessionalMessageCreateInput } from "./schemas";

const conflictMessage =
  "Esta chave de operação já foi usada em outra mensagem. Recarregue a conversa e tente novamente.";

const baseInput: ProfessionalMessageCreateInput = {
  patientId: 41,
  content: "Orientação revisada",
  messageType: "guidance",
  origin: "professional",
  action: "save_draft",
  idempotencyKey: "professional-message-key-123",
};

function scopeRow(
  authorizationId = "authorization-41",
  trackingStatus = "active"
) {
  return [
    [
      {
        authorizationId,
        authorizationStatus: "approved",
        trackingStatus,
        profileActive: 1,
      },
    ],
  ];
}

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-existing",
    conversationId: "conversation-41",
    authorizationId: "authorization-41",
    professionalUserId: 7,
    patientUserId: 41,
    authorUserId: 7,
    direction: "professional_to_patient",
    origin: "professional",
    messageType: "guidance",
    content: "Orientação revisada",
    state: "draft",
    requestedAction: "save_draft",
    idempotencyKey: "professional-message-key-123",
    relatedGuidanceId: null,
    supersedesMessageId: null,
    createdAt: new Date("2026-07-28T13:00:00.000Z"),
    ...overrides,
  };
}

function duplicateDb(options: {
  scopedRow: Record<string, unknown> | null;
  collisionExists?: boolean;
  trackingStatus?: string;
}) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(scopeRow("authorization-41", options.trackingStatus));
  execute.mockResolvedValueOnce(
    options.scopedRow ? [[options.scopedRow]] : [[]]
  );
  if (!options.scopedRow) {
    execute.mockResolvedValueOnce(
      options.collisionExists ? [[{ id: "message-collision" }]] : [[]]
    );
    if (!options.collisionExists) {
      execute.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);
    }
  }
  const txExecute = vi
    .fn()
    .mockResolvedValueOnce(scopeRow())
    .mockResolvedValueOnce([[{ status: "active" }]])
    .mockResolvedValueOnce([{ affectedRows: 1 }])
    .mockResolvedValueOnce([[{ id: "conversation-41" }]])
    .mockRejectedValueOnce(new Error("Duplicate entry for idempotency key"));
  return {
    execute,
    transaction: vi.fn(
      async (callback: (tx: { execute: typeof txExecute }) => unknown) =>
        callback({ execute: txExecute })
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserWhatsappConnection.mockResolvedValue({
    status: "active",
    phoneNumber: "5511999999999",
  });
  mocks.send.mockResolvedValue({ result: { primaryOk: true } });
});

describe("professional message creation idempotency", () => {
  it("returns the original logical message only for an equivalent replay", async () => {
    const db = duplicateDb({ scopedRow: existingRow() });
    mocks.getDb.mockResolvedValue(db);

    await expect(createProfessionalMessage(7, baseInput)).resolves.toMatchObject({
      id: "message-existing",
      professionalUserId: 7,
      patientUserId: 41,
      content: "Orientação revisada",
      state: "draft",
    });
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("returns an equivalent replay after tracking has ended without creating again", async () => {
    const db = duplicateDb({
      scopedRow: existingRow(),
      trackingStatus: "ended",
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(createProfessionalMessage(7, baseInput)).resolves.toMatchObject({
      id: "message-existing",
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("completes an interrupted equivalent web delivery without creating another message", async () => {
    const input: ProfessionalMessageCreateInput = {
      ...baseInput,
      action: "send_web",
      idempotencyKey: "professional-message-web-replay",
    };
    const pending = existingRow({
      state: "pending",
      requestedAction: "send_web",
      idempotencyKey: input.idempotencyKey,
    });
    const execute = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce([[pending]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ ...pending, state: "sent", sentAt: new Date() }]]);
    const transaction = vi.fn();
    mocks.getDb.mockResolvedValue({ execute, transaction });

    await expect(createProfessionalMessage(7, input)).resolves.toMatchObject({
      id: "message-existing",
      state: "sent",
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("resumes an interrupted equivalent WhatsApp delivery on the same logical message", async () => {
    const input: ProfessionalMessageCreateInput = {
      ...baseInput,
      action: "send_whatsapp",
      idempotencyKey: "professional-message-whatsapp-replay",
    };
    const pending = existingRow({
      state: "pending",
      requestedAction: "send_whatsapp",
      idempotencyKey: input.idempotencyKey,
      authorName: "Nutricionista",
    });
    const sent = { ...pending, state: "sent", sentAt: new Date() };
    const execute = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce([[pending]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[pending]])
      .mockResolvedValueOnce([[{ number: 1 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[sent]]);
    const transaction = vi.fn(
      async (callback: (tx: { execute: typeof execute }) => unknown) =>
        callback({ execute })
    );
    mocks.getDb.mockResolvedValue({ execute, transaction });

    await expect(createProfessionalMessage(7, input)).resolves.toMatchObject({
      id: "message-existing",
      state: "sent",
    });
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["outro conteúdo", existingRow({ content: "Conteúdo anterior" })],
    ["outra ação", existingRow({ requestedAction: "send_web", state: "sent" })],
    ["outra origem", existingRow({ origin: "ai_suggested" })],
    ["outro tipo", existingRow({ messageType: "administrative" })],
  ])("rejects divergent payload in the same scope for %s", async (_case, row) => {
    mocks.getDb.mockResolvedValue(duplicateDb({ scopedRow: row }));

    await expect(createProfessionalMessage(7, baseInput)).rejects.toThrow(
      conflictMessage
    );
  });

  it.each(["outro paciente", "outro profissional", "outra autorização"])(
    "rejects a key owned by %s without loading its private row",
    async () => {
      const db = duplicateDb({ scopedRow: null, collisionExists: true });
      mocks.getDb.mockResolvedValue(db);

      await expect(createProfessionalMessage(7, baseInput)).rejects.toThrow(
        conflictMessage
      );
      expect(db.execute).toHaveBeenCalledTimes(3);
      expect(db.transaction).not.toHaveBeenCalled();
    }
  );

  it("preserves the original database error when no message owns the key", async () => {
    mocks.getDb.mockResolvedValue(
      duplicateDb({ scopedRow: null, collisionExists: false })
    );

    await expect(createProfessionalMessage(7, baseInput)).rejects.toThrow(
      "Duplicate entry for idempotency key"
    );
  });
});
