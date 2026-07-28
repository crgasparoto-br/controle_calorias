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
vi.mock("../whatsapp/replyContract", () => ({
  textReply: vi.fn(),
}));

import {
  createProfessionalMessage,
} from "./messageService";
import { ProfessionalMessageAccessUnavailableError } from "./messageRetryAccess";

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

function scopeRow(trackingStatus = "active") {
  return [
    [
      {
        authorizationId: "authorization-41",
        authorizationStatus: "approved",
        trackingStatus,
        profileActive: 1,
      },
    ],
  ];
}

function dbWithTransactionalScope(options: {
  accessAvailable: boolean;
  trackingStatus?: string;
}) {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(scopeRow("active"))
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[]]);
  const txExecute = vi.fn().mockResolvedValueOnce(
    options.accessAvailable ? [[{ authorizationId: "authorization-41" }]] : [[]]
  );
  if (options.accessAvailable) {
    txExecute.mockResolvedValueOnce(
      options.trackingStatus
        ? [[{ status: options.trackingStatus }]]
        : [[]]
    );
  }
  const transaction = vi.fn(
    async (callback: (tx: { execute: typeof txExecute }) => unknown) =>
      callback({ execute: txExecute })
  );
  return { execute, txExecute, transaction };
}

const input = {
  patientId: 41,
  content: "Mensagem concorrente",
  messageType: "guidance" as const,
  origin: "professional" as const,
  action: "save_draft" as const,
  idempotencyKey: "concurrent-message-key-41",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("professional message creation concurrency", () => {
  it("blocks creation when authorization is revoked after the initial validation", async () => {
    const db = dbWithTransactionalScope({ accessAvailable: false });
    mocks.getDb.mockResolvedValue(db);

    const result = createProfessionalMessage(7, input);
    await expect(result).rejects.toBeInstanceOf(
      ProfessionalMessageAccessUnavailableError
    );
    await expect(result).rejects.toThrow(
      "O acesso a este paciente não está mais disponível."
    );

    expect(db.txExecute).toHaveBeenCalledTimes(1);
    expect(collectStrings(db.txExecute.mock.calls[0]?.[0]).join(" ")).toContain(
      "FOR UPDATE"
    );
  });

  it("blocks creation when tracking ends before the transactional insert", async () => {
    const db = dbWithTransactionalScope({
      accessAvailable: true,
      trackingStatus: "ended",
    });
    mocks.getDb.mockResolvedValue(db);

    await expect(createProfessionalMessage(7, input)).rejects.toThrow(
      "O acompanhamento foi encerrado e não aceita novas mensagens."
    );
    expect(db.txExecute).toHaveBeenCalledTimes(2);
  });
});
