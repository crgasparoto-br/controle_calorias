import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWhatsappConversationContext,
  getWhatsappConversationPendingContext,
  registerWhatsappConversationPendingContext,
  resolveWhatsappConversationContext,
} from "./conversationContext";

describe("conversationContext destructive precedence #856", () => {
  beforeEach(() => clearWhatsappConversationContext());

  it("libera um novo comando destrutivo completo e substitui a pendência alimentar em memória", () => {
    registerWhatsappConversationPendingContext(81, {
      action: "record_adjustment_selection_needed",
      reply: "Escolha o alimento que deseja ajustar.",
      data: {
        options: [
          { id: "a", label: "Registrar", value: { mealId: 10, itemIndex: 0 } },
          { id: "b", label: "Arroz", value: { mealId: 10, itemIndex: 1 } },
        ],
      },
    });

    const result = resolveWhatsappConversationContext(81, { text: "Excluir o Registrar" });

    expect(result).toBeNull();
    expect(getWhatsappConversationPendingContext(81)).toBeNull();
  });

  it("mantém respostas curtas compatíveis no resolvedor da pendência alimentar", () => {
    registerWhatsappConversationPendingContext(82, {
      action: "record_adjustment_selection_needed",
      reply: "Escolha o alimento que deseja ajustar.",
      data: {
        options: [{ id: "a", label: "Arroz", value: { mealId: 10, itemIndex: 0 } }],
      },
    });

    const result = resolveWhatsappConversationContext(82, { text: "1" });

    expect(result).toEqual(expect.objectContaining({
      action: "conversation_context_option_selected",
      data: expect.objectContaining({ pendingConsumed: true }),
    }));
  });
});
