import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
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

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.getDb.mockReset();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
});

describe("listProfessionalMessages ended tracking", () => {
  it("blocks the individual conversation before message rows are queried", async () => {
    mocks.execute.mockResolvedValueOnce([
      [
        {
          authorizationId: "authorization-ended",
          authorizationStatus: "approved",
          trackingStatus: "ended",
          profileActive: 1,
        },
      ],
    ]);

    await expect(
      listProfessionalMessages(7, { patientId: 41, pageSize: 20 })
    ).rejects.toThrow(
      "O acompanhamento foi encerrado. Somente o histórico profissional permanece disponível."
    );
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
});
