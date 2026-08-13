import { describe, expect, it, vi } from "vitest";
import { createDrizzleWhatsAppConversationRepository } from "./whatsappConversationRepository";

vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  isNotNull: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
}));

type WrappedDbError = Error & {
  code?: string;
  errno?: number;
  cause?: unknown;
};

function wrappedError(cause: WrappedDbError): WrappedDbError {
  return Object.assign(new Error("Failed query: insert into whatsappConversationMessages"), { cause });
}

function createRepositoryWithInsertError(error: unknown, existingMessage?: Record<string, unknown>) {
  const onWarning = vi.fn();
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => existingMessage ? [existingMessage] : []),
      })),
    })),
  }));
  const db = {
    insert: vi.fn(() => ({
      values: vi.fn(async () => {
        throw error;
      }),
    })),
    select,
  };
  const repository = createDrizzleWhatsAppConversationRepository({
    getDb: async () => db,
    onWarning,
  });
  return { repository, onWarning, select };
}

const appendInput = {
  conversationId: 10,
  userId: 7,
  direction: "inbound" as const,
  externalMessageId: "wamid.retry",
  contentType: "text" as const,
  occurredAt: new Date("2026-08-13T12:00:00Z"),
};

describe("whatsapp conversation duplicate-entry recovery", () => {
  it("recupera a mensagem existente quando Drizzle encapsula ER_DUP_ENTRY em cause", async () => {
    const driverError = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
    });
    const existingMessage = { id: 42, idempotencyKey: "whatsapp:inbound:wamid.retry" };
    const { repository, onWarning } = createRepositoryWithInsertError(
      wrappedError(driverError),
      existingMessage,
    );

    const result = await repository.appendMessage(appendInput);

    expect(result?.wasNewInsert).toBe(false);
    expect(result?.message.id).toBe(42);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("reconhece errno 1062 mesmo quando o driver nao expoe code", async () => {
    const driverError = Object.assign(new Error("Duplicate entry"), { errno: 1062 });
    const adapterError = Object.assign(new Error("Driver execution failed"), { cause: driverError });
    const existingMessage = { id: 43, idempotencyKey: "whatsapp:inbound:wamid.retry" };
    const { repository, onWarning } = createRepositoryWithInsertError(
      wrappedError(adapterError),
      existingMessage,
    );

    const result = await repository.appendMessage(appendInput);

    expect(result?.wasNewInsert).toBe(false);
    expect(result?.message.id).toBe(43);
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("nao trata outro erro de banco encapsulado como duplicidade", async () => {
    const driverError = Object.assign(new Error("Lock wait timeout"), {
      code: "ER_LOCK_WAIT_TIMEOUT",
      errno: 1205,
    });
    const { repository, onWarning, select } = createRepositoryWithInsertError(
      wrappedError(driverError),
    );

    const result = await repository.appendMessage(appendInput);

    expect(result).toBeNull();
    expect(select).not.toHaveBeenCalled();
    expect(onWarning).toHaveBeenCalledOnce();
    expect(onWarning).toHaveBeenCalledWith("WhatsApp conversation message append skipped", expect.any(Error));
  });
});
