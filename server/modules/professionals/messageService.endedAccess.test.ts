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

import {
  createProfessionalMessage,
  listProfessionalMessages,
} from "./messageService";

function endedScope() {
  return [
    [
      {
        authorizationId: "authorization-ended",
        authorizationStatus: "approved",
        trackingStatus: "ended",
        profileActive: 1,
      },
    ],
  ];
}

beforeEach(() => {
  mocks.execute.mockReset();
  mocks.getDb.mockReset();
  mocks.getDb.mockResolvedValue({ execute: mocks.execute });
});

describe("professional messages after tracking ends", () => {
  it("keeps the existing conversation readable without exposing internal identifiers as names", async () => {
    mocks.execute
      .mockResolvedValueOnce(endedScope())
      .mockResolvedValueOnce([
        [
          {
            id: "message-1",
            conversationId: "conversation-1",
            professionalUserId: 7,
            patientUserId: 41,
            direction: "professional_to_patient",
            origin: "professional",
            messageType: "administrative",
            content: "Mensagem anterior",
            state: "sent",
            patientName: null,
            authorName: "Nutricionista",
            createdAt: new Date("2026-07-20T12:00:00.000Z"),
          },
        ],
      ]);

    await expect(
      listProfessionalMessages(7, { patientId: 41, pageSize: 20 })
    ).resolves.toMatchObject({
      items: [
        {
          id: "message-1",
          patientName: null,
          authorName: "Nutricionista",
        },
      ],
      nextCursor: null,
    });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("blocks non-administrative drafts while tracking is paused", async () => {
    mocks.execute.mockResolvedValueOnce([
      [
        {
          authorizationId: "authorization-paused",
          authorizationStatus: "approved",
          trackingStatus: "paused",
          profileActive: 1,
        },
      ],
    ]);

    await expect(
      createProfessionalMessage(7, {
        patientId: 41,
        content: "Orientação durante a pausa",
        messageType: "guidance",
        origin: "professional",
        action: "save_draft",
        idempotencyKey: "paused-guidance-draft",
      })
    ).rejects.toThrow(
      "Durante a pausa, crie somente comunicações administrativas."
    );
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each(["save_draft", "send_web", "send_whatsapp"] as const)(
    "blocks %s for ended tracking",
    async action => {
      mocks.execute.mockResolvedValueOnce(endedScope());

      await expect(
        createProfessionalMessage(7, {
          patientId: 41,
          content: "Nova mensagem após encerramento",
          messageType: "administrative",
          origin: "professional",
          action,
          idempotencyKey: `ended-${action}`,
        })
      ).rejects.toThrow(
        "O acompanhamento foi encerrado e não aceita novas mensagens."
      );
      expect(mocks.execute).toHaveBeenCalledTimes(1);
    }
  );
});
