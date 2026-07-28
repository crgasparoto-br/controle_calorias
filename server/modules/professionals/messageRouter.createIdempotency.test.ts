import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock("./entitledProcedure", async () => {
  const { protectedProcedure } = await import("../../_core/trpc");
  return { professionalMessagesProcedure: protectedProcedure };
});
vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  getUserWhatsappConnection: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));
vi.mock("../whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppStandaloneLogicalReply: vi.fn(),
}));
vi.mock("./settingsService", () => ({
  getProfessionalSettingsSnapshot: vi.fn(),
}));
vi.mock("./service", () => ({
  listProfessionalAccesses: vi.fn(),
}));

import { professionalMessageRouter } from "./messageRouter";

function caller() {
  return professionalMessageRouter.createCaller({
    req: {} as never,
    res: {} as never,
    user: { id: 7 } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("professionalMessageRouter.create idempotency boundary", () => {
  it("does not return a message from another patient when the key is reused", async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([
        [
          {
            authorizationId: "authorization-42",
            authorizationStatus: "approved",
            trackingStatus: "active",
            profileActive: 1,
          },
        ],
      ])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ id: "message-patient-41" }]]);
    const txExecute = vi
      .fn()
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ id: "conversation-42" }]])
      .mockRejectedValueOnce(new Error("Duplicate entry"));
    mocks.getDb.mockResolvedValue({
      execute,
      transaction: async (
        callback: (tx: { execute: typeof txExecute }) => unknown
      ) => callback({ execute: txExecute }),
    });

    await expect(
      caller().create({
        patientId: 42,
        content: "Mensagem do paciente 42",
        messageType: "guidance",
        origin: "professional",
        action: "save_draft",
        idempotencyKey: "shared-idempotency-key",
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message:
        "Esta chave de operação já foi usada em outra mensagem. Recarregue a conversa e tente novamente.",
    });
  });
});
