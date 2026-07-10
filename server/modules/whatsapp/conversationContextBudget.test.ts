import { describe, expect, it } from "vitest";
import { CONTEXT_BUDGETS, getEffectiveMessageText, selectRecentWindow } from "./conversationContextBudget";
import type { WhatsAppConversationMessageRecord } from "../../repositories/whatsappConversationRepository";

function buildMessage(overrides: Partial<WhatsAppConversationMessageRecord> & { id: number; sanitizedText: string }): WhatsAppConversationMessageRecord {
  return {
    id: overrides.id,
    conversationId: 1,
    userId: 1,
    direction: "inbound",
    channel: "whatsapp",
    externalMessageId: `wamid.${overrides.id}`,
    idempotencyKey: `whatsapp:inbound:wamid.${overrides.id}`,
    contentType: "text",
    rawTextStored: false,
    text: null,
    sanitizedText: overrides.sanitizedText,
    transcript: null,
    sanitizedTranscript: null,
    mediaStorageKey: null,
    mediaMimeType: null,
    captionText: null,
    privacyPolicyVersion: null,
    retentionExpiresAt: null,
    respondsToMessageId: null,
    occurredAt: new Date(2026, 6, 11, 12, overrides.id),
    processedAt: null,
    createdAt: new Date(2026, 6, 11, 12, overrides.id),
    updatedAt: new Date(2026, 6, 11, 12, overrides.id),
    ...overrides,
  } as WhatsAppConversationMessageRecord;
}

describe("conversationContextBudget", () => {
  it("mantém todas as mensagens quando estão dentro do orçamento", () => {
    const messages = [
      buildMessage({ id: 1, sanitizedText: "a" }),
      buildMessage({ id: 2, sanitizedText: "b" }),
      buildMessage({ id: 3, sanitizedText: "c" }),
    ];

    const result = selectRecentWindow(messages, { maxTurns: 12, maxChars: 4000 });

    expect(result.window.map(m => m.id)).toEqual([1, 2, 3]);
    expect(result.overflow).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it("respeita o limite de quantidade de turnos, preservando as mais recentes", () => {
    const messages = Array.from({ length: 5 }, (_, i) => buildMessage({ id: i + 1, sanitizedText: `msg-${i + 1}` }));

    const result = selectRecentWindow(messages, { maxTurns: 2, maxChars: 4000 });

    expect(result.window.map(m => m.id)).toEqual([4, 5]);
    expect(result.overflow.map(m => m.id)).toEqual([1, 2, 3]);
    expect(result.truncated).toBe(true);
  });

  it("respeita o limite de caracteres sem partir uma mensagem ao meio", () => {
    const messages = [
      buildMessage({ id: 1, sanitizedText: "x".repeat(50) }),
      buildMessage({ id: 2, sanitizedText: "y".repeat(50) }),
      buildMessage({ id: 3, sanitizedText: "z".repeat(50) }),
    ];

    // Orçamento comporta só as duas mais recentes inteiras (50+50=100 <= 120), não as três (150 > 120).
    const result = selectRecentWindow(messages, { maxTurns: 12, maxChars: 120 });

    expect(result.window.map(m => m.id)).toEqual([2, 3]);
    expect(result.overflow.map(m => m.id)).toEqual([1]);
    expect(result.truncated).toBe(true);
  });

  it("sempre inclui ao menos a mensagem mais recente, mesmo se ela sozinha exceder o orçamento de caracteres", () => {
    const messages = [
      buildMessage({ id: 1, sanitizedText: "a".repeat(10) }),
      buildMessage({ id: 2, sanitizedText: "z".repeat(500) }),
    ];

    const result = selectRecentWindow(messages, { maxTurns: 12, maxChars: 50 });

    expect(result.window.map(m => m.id)).toEqual([2]);
    expect(result.overflow.map(m => m.id)).toEqual([1]);
    expect(result.truncated).toBe(true);
  });

  it("corte é determinístico: mesma entrada produz sempre o mesmo resultado", () => {
    const messages = Array.from({ length: 20 }, (_, i) => buildMessage({ id: i + 1, sanitizedText: `mensagem numero ${i + 1}` }));

    const first = selectRecentWindow(messages, CONTEXT_BUDGETS.intent_classifier);
    const second = selectRecentWindow(messages, CONTEXT_BUDGETS.intent_classifier);

    expect(first).toEqual(second);
  });

  it("isola o corte por usuário quando aplicado a listas diferentes (sem estado compartilhado)", () => {
    const userA = [buildMessage({ id: 1, userId: 1, sanitizedText: "mensagem do usuário A" })];
    const userB = [buildMessage({ id: 2, userId: 2, sanitizedText: "mensagem do usuário B" })];

    const resultA = selectRecentWindow(userA, CONTEXT_BUDGETS.intent_classifier);
    const resultB = selectRecentWindow(userB, CONTEXT_BUDGETS.intent_classifier);

    expect(resultA.window).toHaveLength(1);
    expect(resultB.window).toHaveLength(1);
    expect(resultA.window[0].userId).toBe(1);
    expect(resultB.window[0].userId).toBe(2);
  });

  it("getEffectiveMessageText prioriza sanitizedText, depois text, transcript, sanitizedTranscript e captionText", () => {
    expect(getEffectiveMessageText(buildMessage({ id: 1, sanitizedText: "s" }))).toBe("s");
    expect(getEffectiveMessageText(buildMessage({ id: 2, sanitizedText: null as unknown as string, text: "t" }))).toBe("t");
    expect(getEffectiveMessageText(buildMessage({ id: 3, sanitizedText: null as unknown as string, text: null, sanitizedTranscript: "st" }))).toBe("st");
    expect(getEffectiveMessageText(buildMessage({ id: 4, sanitizedText: null as unknown as string, text: null, captionText: "c" }))).toBe("c");
    expect(getEffectiveMessageText(buildMessage({ id: 5, sanitizedText: null as unknown as string, text: null }))).toBe("");
  });
});
