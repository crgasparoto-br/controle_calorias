import { beforeEach, describe, expect, it, vi } from "vitest";

const purgeExpiredRawTextMock = vi.fn(async () => 2);
const purgeExpiredSanitizedTextMock = vi.fn(async () => 3);
const purgeExpiredAuditRowsMock = vi.fn(async () => 1);
const purgeInactiveOperationsMock = vi.fn(async () => 4);
const logInferenceEventMock = vi.fn();

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("../../repositories/whatsappConversationRepository", () => ({
  createDrizzleWhatsAppConversationRepository: () => ({
    purgeExpiredRawText: purgeExpiredRawTextMock,
    purgeExpiredSanitizedText: purgeExpiredSanitizedTextMock,
    purgeExpiredAuditRows: purgeExpiredAuditRowsMock,
  }),
}));

vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: () => ({
    purgeInactiveOperations: purgeInactiveOperationsMock,
  }),
}));

const { runConversationRetentionSweep } = await import("./conversationRetentionService");

describe("runConversationRetentionSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("executa todas as etapas de limpeza e retorna as contagens", async () => {
    const result = await runConversationRetentionSweep("scheduled");

    expect(result).toEqual({
      rowsRawNulled: 2,
      rowsSanitizedNulled: 3,
      rowsDeleted: 1,
      pendingOpsDeleted: 4,
    });
  });

  it("registra um evento de observabilidade só com contagens, sem conteúdo sensível", async () => {
    await runConversationRetentionSweep("admin");

    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.history.retention_run",
    }));
    const detail = JSON.parse(logInferenceEventMock.mock.calls[0][0].detail);
    expect(detail).toEqual({
      trigger: "admin",
      rowsRawNulled: 2,
      rowsSanitizedNulled: 3,
      rowsDeleted: 1,
      pendingOpsDeleted: 4,
    });
  });

  it("é idempotente: rodar novamente sem linhas vencidas não falha e reporta zeros", async () => {
    purgeExpiredRawTextMock.mockResolvedValueOnce(0);
    purgeExpiredSanitizedTextMock.mockResolvedValueOnce(0);
    purgeExpiredAuditRowsMock.mockResolvedValueOnce(0);
    purgeInactiveOperationsMock.mockResolvedValueOnce(0);

    const result = await runConversationRetentionSweep("scheduled");
    expect(result).toEqual({ rowsRawNulled: 0, rowsSanitizedNulled: 0, rowsDeleted: 0, pendingOpsDeleted: 0 });
  });
});
