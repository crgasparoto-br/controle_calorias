import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetWhatsappConversationContextsForTests,
  createWhatsappConversationContext,
  getActiveWhatsappConversationContext,
  resolveWhatsappConversationContext,
} from "./conversationContext";

describe("conversationContext", () => {
  beforeEach(() => {
    __resetWhatsappConversationContextsForTests();
  });

  it("consome resposta numerica usando a pendencia de selecao ativa", () => {
    createWhatsappConversationContext({
      userId: 42,
      kind: "selection",
      originalText: "remove arroz",
      options: [
        { id: "meal-1", label: "Arroz no almoço" },
        { id: "meal-2", label: "Arroz no jantar" },
      ],
      now: new Date("2026-06-14T12:00:00.000Z"),
    });

    const result = resolveWhatsappConversationContext(42, {
      text: "a segunda opção",
      receivedAt: new Date("2026-06-14T12:01:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_selection_received",
      data: expect.objectContaining({
        selectedNumber: 2,
        selectedOptionId: "meal-2",
      }),
    }));
    expect(getActiveWhatsappConversationContext(42, new Date("2026-06-14T12:01:00.000Z"))).toBeNull();
  });

  it("consome selecao por texto da opcao", () => {
    createWhatsappConversationContext({
      userId: 42,
      kind: "selection",
      originalText: "remove arroz",
      options: [
        { id: "meal-1", label: "Arroz no almoço" },
        { id: "meal-2", label: "Arroz no jantar" },
      ],
      now: new Date("2026-06-14T12:00:00.000Z"),
    });

    const result = resolveWhatsappConversationContext(42, {
      text: "arroz no jantar",
      receivedAt: new Date("2026-06-14T12:01:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_selection_received",
      data: expect.objectContaining({
        selectedNumber: 2,
        selectedOptionId: "meal-2",
        selectedOptionLabel: "Arroz no jantar",
      }),
    }));
    expect(getActiveWhatsappConversationContext(42, new Date("2026-06-14T12:01:00.000Z"))).toBeNull();
  });

  it("mantem selecao pendente ate receber uma opcao valida", () => {
    createWhatsappConversationContext({
      userId: 42,
      kind: "selection",
      originalText: "remove arroz",
      options: [
        { id: "meal-1", label: "Arroz no almoço" },
        { id: "meal-2", label: "Arroz no jantar" },
      ],
      now: new Date("2026-06-14T12:00:00.000Z"),
    });

    const invalidNumber = resolveWhatsappConversationContext(42, {
      text: "9",
      receivedAt: new Date("2026-06-14T12:01:00.000Z"),
    });
    const contextualReference = resolveWhatsappConversationContext(42, {
      text: "isso",
      receivedAt: new Date("2026-06-14T12:02:00.000Z"),
    });
    const validSelection = resolveWhatsappConversationContext(42, {
      text: "2",
      receivedAt: new Date("2026-06-14T12:03:00.000Z"),
    });

    expect(invalidNumber).toEqual(expect.objectContaining({
      action: "conversation_context_clarification_needed",
      data: expect.objectContaining({ selectedNumber: 9, optionCount: 2 }),
    }));
    expect(contextualReference).toEqual(expect.objectContaining({
      action: "conversation_context_clarification_needed",
      data: expect.objectContaining({ optionCount: 2 }),
    }));
    expect(validSelection).toEqual(expect.objectContaining({
      action: "conversation_context_selection_received",
      data: expect.objectContaining({ selectedNumber: 2 }),
    }));
    expect(getActiveWhatsappConversationContext(42, new Date("2026-06-14T12:03:00.000Z"))).toBeNull();
  });

  it("cancela selecao pendente com nenhuma", () => {
    createWhatsappConversationContext({
      userId: 42,
      kind: "selection",
      originalText: "remove arroz",
      options: [
        { id: "meal-1", label: "Arroz no almoço" },
        { id: "meal-2", label: "Arroz no jantar" },
      ],
      now: new Date("2026-06-14T12:00:00.000Z"),
    });

    const result = resolveWhatsappConversationContext(42, {
      text: "nenhuma",
      receivedAt: new Date("2026-06-14T12:01:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_cancelled",
      reply: expect.stringContaining("Nada foi alterado"),
    }));
    expect(getActiveWhatsappConversationContext(42, new Date("2026-06-14T12:01:00.000Z"))).toBeNull();
  });

  it("cancela confirmacao pendente com resposta negativa curta", () => {
    createWhatsappConversationContext({
      userId: 42,
      kind: "confirmation",
      originalText: "apaga o ultimo",
      options: [
        { id: "confirm", label: "Confirmar" },
        { id: "cancel", label: "Cancelar" },
      ],
      now: new Date("2026-06-14T12:00:00.000Z"),
    });

    const result = resolveWhatsappConversationContext(42, {
      text: "não",
      receivedAt: new Date("2026-06-14T12:02:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_cancelled",
      reply: expect.stringContaining("Nada foi alterado"),
    }));
    expect(getActiveWhatsappConversationContext(42, new Date("2026-06-14T12:02:00.000Z"))).toBeNull();
  });

  it("bloqueia resposta curta quando a pendencia expirou", () => {
    createWhatsappConversationContext({
      userId: 42,
      kind: "selection",
      originalText: "remove arroz",
      options: [{ id: "1", label: "Arroz no almoço" }],
      now: new Date("2026-06-14T12:00:00.000Z"),
      ttlMs: 1000,
    });

    const result = resolveWhatsappConversationContext(42, {
      text: "1",
      receivedAt: new Date("2026-06-14T12:00:02.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_expired",
    }));
    expect(getActiveWhatsappConversationContext(42, new Date("2026-06-14T12:00:02.000Z"))).toBeNull();
  });
});
