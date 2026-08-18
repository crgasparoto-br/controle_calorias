import { beforeEach, describe, expect, it, vi } from "vitest";

const executeCoreMock = vi.fn();
const defaultRepository = { findRecentMessagesByUser: vi.fn() };

vi.mock("./aiQuestionAssistantCore", () => ({
  executeWhatsappAiQuestionIntent: executeCoreMock,
  isWhatsappAiQuestionText: (text?: string | null) => Boolean(text?.trim().startsWith("/")),
  contextUsage: {},
}));
vi.mock("../../db", () => ({ getDb: vi.fn(), logPersistenceWarning: vi.fn() }));
vi.mock("../../repositories/whatsappConversationRepository", () => ({
  createDrizzleWhatsAppConversationRepository: () => defaultRepository,
}));

import { executeWhatsappAiQuestionIntent } from "./aiQuestionAssistant";

describe("QUESTION audit remediation: optional recent history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeCoreMock.mockImplementation(async (_userId, input) => ({
      handled: true,
      action: "ai_question_answered",
      reply: "ok",
      eventType: "test",
      detail: "test",
      data: {
        history: await input.conversationRepository?.findRecentMessagesByUser?.(42, 50),
      },
    }));
  });

  it("does not read or forward persisted history for a clearly generic scope=none question", async () => {
    const findRecentMessagesByUser = vi.fn(async () => [{ text: "sensitive-history" }]);
    const result = await executeWhatsappAiQuestionIntent(42, {
      text: "/ qual é a recomendação atual de fibras?",
      userTimezone: "America/Sao_Paulo",
      conversationRepository: { findRecentMessagesByUser } as never,
    });

    expect(findRecentMessagesByUser).not.toHaveBeenCalled();
    expect(result?.data?.history).toEqual([]);
  });

  it("preserves recent history for ambiguous follow-ups", async () => {
    const rows = [{ text: "context-needed" }];
    const findRecentMessagesByUser = vi.fn(async () => rows);
    const result = await executeWhatsappAiQuestionIntent(42, {
      text: "/ e quanto ao que você disse antes?",
      userTimezone: "America/Sao_Paulo",
      conversationRepository: { findRecentMessagesByUser } as never,
    });

    expect(findRecentMessagesByUser).toHaveBeenCalledTimes(1);
    expect(result?.data?.history).toEqual(rows);
  });
});
