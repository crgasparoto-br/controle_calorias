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
  createProfessionalMessage,
  ProfessionalMessageSupersessionConflictError,
} from "./messageService";
import type { ProfessionalMessageCreateInput } from "./schemas";

function collectStrings(
  value: unknown,
  seen = new WeakSet<object>()
): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap(item => collectStrings(item, seen));
  }
  return Object.values(value as Record<string, unknown>).flatMap(item =>
    collectStrings(item, seen)
  );
}

const input: ProfessionalMessageCreateInput = {
  patientId: 41,
  content: "Resumo revisado pelo nutricionista",
  messageType: "follow_up_summary",
  origin: "professional",
  action: "save_draft",
  idempotencyKey: "supersession-message-key-123",
  supersedesMessageId: "4c0e99e0-102b-4b5f-934a-79a8d141ff01",
};

function scopeRow() {
  return [
    [
      {
        authorizationId: "authorization-41",
        authorizationStatus: "approved",
        trackingStatus: "active",
        profileActive: 1,
      },
    ],
  ];
}

function originalDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: input.supersedesMessageId,
    authorizationId: "authorization-41",
    professionalUserId: 7,
    patientUserId: 41,
    authorUserId: 7,
    direction: "professional_to_patient",
    origin: "ai_suggested",
    state: "draft",
    ...overrides,
  };
}

function createdRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-created",
    conversationId: "conversation-41",
    authorizationId: "authorization-41",
    professionalUserId: 7,
    patientUserId: 41,
    authorUserId: 7,
    direction: "professional_to_patient",
    origin: "ai_suggested",
    messageType: "follow_up_summary",
    content: input.content,
    state: "draft",
    requestedAction: "save_draft",
    idempotencyKey: input.idempotencyKey,
    supersedesMessageId: input.supersedesMessageId,
    createdAt: new Date("2026-07-28T18:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

const invalidSupersessionCases: Array<
  [string, Record<string, unknown>]
> = [
  ["another patient", { patientUserId: 99 }],
  ["another professional", { professionalUserId: 99, authorUserId: 99 }],
  ["another authorization", { authorizationId: "authorization-other" }],
  ["a sent message", { state: "sent" }],
  ["a patient-authored message", { direction: "patient_to_professional" }],
];

describe("professional message supersession", () => {
  it("preserves AI provenance even when the client submits another origin", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce([[originalDraft()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[createdRow()]]);
    const txExecute = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce([[{ status: "active" }]])
      .mockResolvedValueOnce([[originalDraft()]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: "conversation-41" }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    const transaction = vi.fn(
      async (callback: (tx: { execute: typeof txExecute }) => unknown) =>
        callback({ execute: txExecute })
    );
    mocks.getDb.mockResolvedValue({ execute, transaction });

    await expect(createProfessionalMessage(7, input)).resolves.toMatchObject({
      origin: "ai_suggested",
    });

    const insertText = collectStrings(txExecute.mock.calls[5]?.[0]).join(" ");
    expect(insertText).toContain("ai_suggested");
    const lockText = collectStrings(txExecute.mock.calls[2]?.[0]).join(" ");
    expect(lockText).toContain("FOR UPDATE");
    expect(collectStrings(txExecute.mock.calls[0]?.[0]).join(" ")).toContain(
      "FOR UPDATE"
    );
    expect(collectStrings(txExecute.mock.calls[1]?.[0]).join(" ")).toContain(
      "FOR UPDATE"
    );
  });

  it.each(invalidSupersessionCases)("rejects supersession of %s with the same public error", async (_case, overrides) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce([[originalDraft(overrides)]]);
    const transaction = vi.fn();
    mocks.getDb.mockResolvedValue({ execute, transaction });

    const result = createProfessionalMessage(7, input);
    await expect(result).rejects.toBeInstanceOf(
      ProfessionalMessageSupersessionConflictError
    );
    await expect(result).rejects.toThrow(
      "O rascunho original não está mais disponível para edição."
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it("revalidates the draft under lock before creating the next version", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce([[originalDraft()]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    const txExecute = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce([[{ status: "active" }]])
      .mockResolvedValueOnce([[originalDraft({ state: "sent" })]]);
    const transaction = vi.fn(
      async (callback: (tx: { execute: typeof txExecute }) => unknown) =>
        callback({ execute: txExecute })
    );
    mocks.getDb.mockResolvedValue({ execute, transaction });

    await expect(createProfessionalMessage(7, input)).rejects.toBeInstanceOf(
      ProfessionalMessageSupersessionConflictError
    );
    expect(txExecute).toHaveBeenCalledTimes(3);
    expect(
      collectStrings(txExecute.mock.calls[2]?.[0]).join(" ")
    ).toContain("FOR UPDATE");
  });

  it("normalizes AI provenance before matching an idempotent replay", async () => {
    const existing = createdRow({ id: "message-existing" });
    const execute = vi
      .fn()
      .mockResolvedValueOnce(scopeRow())
      .mockResolvedValueOnce([[originalDraft()]])
      .mockResolvedValueOnce([[existing]]);
    const transaction = vi.fn();
    mocks.getDb.mockResolvedValue({ execute, transaction });

    await expect(createProfessionalMessage(7, input)).resolves.toMatchObject({
      id: "message-existing",
      origin: "ai_suggested",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
});
