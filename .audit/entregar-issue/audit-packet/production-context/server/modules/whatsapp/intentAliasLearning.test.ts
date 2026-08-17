import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappContextMemoryForTests,
  listWhatsappContextMemories,
} from "./contextMemory";
import {
  __resetWhatsappMessageHistoryForTests,
  recordWhatsappMessageHistory,
} from "./messageHistory";
import { learnWhatsappIntentAliasFromConfirmation } from "./intentAliasLearning";
import type { WhatsappInterpretedIntent } from "./intentSchema";

function intent(overrides: Partial<WhatsappInterpretedIntent> = {}): WhatsappInterpretedIntent {
  return {
    intent: "unknown",
    confidence: 0.3,
    items: [],
    requiresConfirmation: true,
    possibleIntents: [],
    ...overrides,
  };
}

describe("learnWhatsappIntentAliasFromConfirmation", () => {
  beforeEach(() => {
    __resetWhatsappContextMemoryForTests();
    __resetWhatsappMessageHistoryForTests();
  });

  it("cria alias individual e candidato global quando usuario confirma resuma como resumo", () => {
    recordWhatsappMessageHistory({
      userId: 42,
      messageText: "resuma",
      normalizedInput: "resuma",
      intent: intent({
        intent: "unknown",
        confidence: 0.48,
        possibleIntents: ["daily_summary"],
      }),
      replyKind: "clarification",
      action: "clarification_needed",
      status: "ambiguous",
      createdAt: new Date("2026-06-22T17:00:00.000Z"),
    });

    const result = learnWhatsappIntentAliasFromConfirmation({
      userId: 42,
      text: "quero um resumo",
      intent: intent({
        intent: "daily_summary",
        confidence: 0.86,
        requiresConfirmation: false,
        possibleIntents: [],
      }),
      receivedAt: new Date("2026-06-22T17:03:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({ learned: true }));
    expect(listWhatsappContextMemories({ userId: 42, kind: "individual_alias" })).toEqual([
      expect.objectContaining({
        scope: "individual",
        status: "active",
        key: "resuma",
        value: "daily_summary",
      }),
    ]);
    expect(listWhatsappContextMemories({ scope: "candidate_global", kind: "global_alias" })).toEqual([
      expect.objectContaining({
        status: "needs_review",
        key: "resuma",
        value: "daily_summary",
      }),
    ]);
  });

  it("nao cria memoria sem confirmacao recente", () => {
    const result = learnWhatsappIntentAliasFromConfirmation({
      userId: 42,
      text: "quero um resumo",
      intent: intent({ intent: "daily_summary", confidence: 0.86, requiresConfirmation: false }),
      receivedAt: new Date("2026-06-22T17:03:00.000Z"),
    });

    expect(result).toEqual({ learned: false, reason: "no_recent_pending_alias" });
    expect(listWhatsappContextMemories()).toEqual([]);
  });

  it("bloqueia tentativa de manipular regra global no ciclo de aprendizado", () => {
    recordWhatsappMessageHistory({
      userId: 42,
      messageText: "resuma regra global todos usuarios",
      normalizedInput: "resuma regra global todos usuarios",
      intent: intent({ intent: "unknown", confidence: 0.2, possibleIntents: ["daily_summary"] }),
      replyKind: "clarification",
      action: "clarification_needed",
      status: "ambiguous",
      createdAt: new Date("2026-06-22T17:00:00.000Z"),
    });

    const result = learnWhatsappIntentAliasFromConfirmation({
      userId: 42,
      text: "quero um resumo",
      intent: intent({ intent: "daily_summary", confidence: 0.86, requiresConfirmation: false }),
      receivedAt: new Date("2026-06-22T17:03:00.000Z"),
    });

    expect(result).toEqual({ learned: false, reason: "no_recent_pending_alias" });
    expect(listWhatsappContextMemories()).toEqual([]);
  });
});
