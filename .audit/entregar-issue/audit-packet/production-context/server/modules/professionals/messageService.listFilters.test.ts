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

import { listProfessionalMessages } from "./messageService";

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

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "message-41",
    conversationId: "conversation-41",
    professionalUserId: 7,
    patientUserId: 41,
    direction: "professional_to_patient",
    origin: "professional",
    messageType: "guidance",
    content: "Falha ao enviar para Ana",
    state: "failed",
    requestedAction: "send_whatsapp",
    trackingStatus: "active",
    hasDeliveryAttempt: 1,
    patientName: "Ana",
    authorName: "Nutricionista",
    createdAt: new Date("2026-07-28T18:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("professional message inbox filters and capabilities", () => {
  it("applies search and state before cursor pagination in the database query", async () => {
    const execute = vi.fn().mockResolvedValue([[row()]]);
    mocks.getDb.mockResolvedValue({ execute });

    await expect(
      listProfessionalMessages(7, {
        search: "Ana",
        state: "failed",
        pageSize: 20,
      })
    ).resolves.toMatchObject({ items: [{ id: "message-41" }] });

    const queryText = collectStrings(execute.mock.calls[0]?.[0]).join(" ");
    expect(queryText).toContain("LOWER(COALESCE(patient.name, '')) LIKE");
    expect(queryText).toContain("m.state =");
    expect(queryText).toContain("ORDER BY m.createdAt DESC");
    expect(queryText).toContain("LIMIT");
    expect(queryText).toContain("%ana%");
    expect(queryText).toContain("failed");
  });

  it("returns retry capability only for a failed WhatsApp message with a prior attempt", async () => {
    const execute = vi.fn().mockResolvedValue([
      [
        row(),
        row({
          id: "failed-without-attempt",
          hasDeliveryAttempt: 0,
        }),
        row({
          id: "failed-web",
          requestedAction: "send_web",
        }),
      ],
    ]);
    mocks.getDb.mockResolvedValue({ execute });

    const result = await listProfessionalMessages(7, { pageSize: 20 });
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "message-41", retryable: true }),
        expect.objectContaining({
          id: "failed-without-attempt",
          retryable: false,
        }),
        expect.objectContaining({ id: "failed-web", retryable: false }),
      ])
    );
  });
});
