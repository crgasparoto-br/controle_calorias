import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  getUserWhatsappConnection: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));
vi.mock("../whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppStandaloneLogicalReply: vi.fn(),
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

function scopeRow(authorizationId = "authorization-41") {
  return [
    [
      {
        authorizationId,
        authorizationStatus: "approved",
        trackingStatus: "active",
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
}) {
  const execute = vi.fn().mockResolvedValueOnce(scopeRow());
  execute.mockResolvedValueOnce(
    options.scopedRow ? [[options.scopedRow]] : [[]]
  );
  if (!options.scopedRow) {
    execute.mockResolvedValueOnce(
      options.collisionExists ? [[{ id: "message-collision" }]] : [[]]
    );
  }
  const txExecute = vi
    .fn()
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
