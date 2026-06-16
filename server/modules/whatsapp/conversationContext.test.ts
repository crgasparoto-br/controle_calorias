import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWhatsappConversationContext,
  getWhatsappConversationPendingContext,
  registerWhatsappConversationPendingContext,
  resolveWhatsappConversationContext,
} from "./conversationContext";

describe("whatsapp conversation context", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
  });

  it("bloqueia resposta curta sem contexto ativo", () => {
    const result = resolveWhatsappConversationContext(42, { text: "sim" });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_clarification_needed",
      data: expect.objectContaining({
        contextUsed: false,
        pendingConsumed: false,
        decision: "missing_context",
      }),
    }));
  });

  it("registra pendencia de selecao e resolve a primeira opcao em confirmacao", () => {
    registerWhatsappConversationPendingContext(42, {
      action: "record_adjustment_selection_needed",
      reply: "Qual item?",
      data: {
        options: [
          { id: "10:0", label: "Frango grelhado", value: { mealId: 10, itemIndex: 0 } },
          { id: "10:1", label: "Frango desfiado", value: { mealId: 10, itemIndex: 1 } },
        ],
      },
    }, { text: "remove frango", receivedAt: new Date("2026-06-14T15:00:00.000Z") });

    const result = resolveWhatsappConversationContext(42, {
      text: "a primeira opção",
      receivedAt: new Date("2026-06-14T15:01:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_option_selected",
      data: expect.objectContaining({
        contextUsed: true,
        pendingConsumed: true,
        clarificationQuestion: "Qual item?",
        userResponse: "a primeira opcao",
        decision: "option_selected",
        selectedOption: expect.objectContaining({ id: "10:0" }),
        nextPendingContext: expect.objectContaining({ kind: "confirmation" }),
      }),
    }));
  });

  it("resolve selecao por numero em confirmacao", () => {
    registerWhatsappConversationPendingContext(42, {
      action: "record_adjustment_selection_needed",
      reply: "Qual item?",
      data: {
        options: [
          { id: "10:0", label: "Frango grelhado", value: { mealId: 10, itemIndex: 0 } },
          { id: "10:1", label: "Frango desfiado", value: { mealId: 10, itemIndex: 1 } },
        ],
      },
    }, { text: "remove frango", receivedAt: new Date("2026-06-14T15:00:00.000Z") });

    const result = resolveWhatsappConversationContext(42, {
      text: "opção 2",
      receivedAt: new Date("2026-06-14T15:01:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_option_selected",
      data: expect.objectContaining({
        selectedOption: expect.objectContaining({ id: "10:1" }),
        decision: "option_selected",
      }),
    }));
  });

  it("encerra selecao ativa quando usuario responde nenhuma", () => {
    registerWhatsappConversationPendingContext(42, {
      action: "record_adjustment_selection_needed",
      reply: "Qual item?",
      data: {
        options: [
          { id: "10:0", label: "Frango grelhado", value: { mealId: 10, itemIndex: 0 } },
          { id: "10:1", label: "Frango desfiado", value: { mealId: 10, itemIndex: 1 } },
        ],
      },
    }, { text: "remove frango", receivedAt: new Date("2026-06-14T15:00:00.000Z") });

    const result = resolveWhatsappConversationContext(42, {
      text: "nenhuma",
      receivedAt: new Date("2026-06-14T15:01:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_cancelled",
      data: expect.objectContaining({
        contextUsed: true,
        pendingConsumed: true,
        decision: "none_selected",
        userResponse: "nenhuma",
      }),
    }));
    expect(getWhatsappConversationPendingContext(42)).toBeNull();
  });

  it("consome confirmacao ativa sem fallback alimentar", () => {
    registerWhatsappConversationPendingContext(42, {
      action: "record_adjustment_confirmation_needed",
      reply: "Confirma?",
      data: { adjustmentKind: "quantity", mealId: 10, itemName: "Arroz", quantity: 150, unit: "g" },
    }, { text: "era 150g", receivedAt: new Date("2026-06-14T15:00:00.000Z") });

    const result = resolveWhatsappConversationContext(42, {
      text: "sim",
      receivedAt: new Date("2026-06-14T15:01:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_confirmation_accepted",
      data: expect.objectContaining({
        contextUsed: true,
        pendingConsumed: true,
        decision: "confirmed",
        target: expect.objectContaining({ mealId: 10 }),
      }),
    }));
    expect(getWhatsappConversationPendingContext(42)).toBeNull();
  });

  it("expira pendencia de forma previsivel", () => {
    registerWhatsappConversationPendingContext(42, {
      action: "record_adjustment_confirmation_needed",
      reply: "Confirma?",
      data: { adjustmentKind: "remove_last_meal", mealId: 10 },
    }, {
      text: "apaga o ultimo",
      receivedAt: new Date("2026-06-14T15:00:00.000Z"),
      ttlMs: 60_000,
    });

    const result = resolveWhatsappConversationContext(42, {
      text: "sim",
      receivedAt: new Date("2026-06-14T15:02:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_clarification_needed",
      data: expect.objectContaining({
        contextUsed: false,
        pendingExpired: true,
        decision: "expired",
      }),
    }));
  });
});
