import { beforeEach, describe, expect, it, vi } from "vitest";

const executeWhatsappTextIntentMock = vi.hoisted(() => vi.fn());

vi.mock("./intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));

const {
  completeWhatsappIntentClarificationCallback,
  INTENT_CLARIFICATION_ACTIONS,
  parseIntentClarificationTextAction,
} = await import("./intentClarificationInteraction");

const target = {
  contractVersion: 1 as const,
  interactionId: "intent_clarification.generic" as const,
  kind: "intent_clarification" as const,
  originalText: "1 iorgute natual",
  actions: [...INTENT_CLARIFICATION_ACTIONS],
};

describe("ações da clarificação genérica da issue #858", () => {
  beforeEach(() => {
    executeWhatsappTextIntentMock.mockReset();
  });

  it.each([
    ["Registrar alimento", "register_food"],
    ["Corrigir refeição", "correct_meal"],
    ["Consultar registros", "consult_records"],
    ["Cancelar", "cancel"],
    ["1", "register_food"],
    ["2", "correct_meal"],
    ["3", "consult_records"],
  ])("mapeia a alternativa textual %s para a ação canônica %s", (text, action) => {
    expect(parseIntentClarificationTextAction(text)).toBe(action);
  });

  it("Registrar alimento retoma a mensagem original pelo executor canônico", async () => {
    executeWhatsappTextIntentMock.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "Qual é o peso?",
      eventType: "whatsapp.food_clarification.requested",
      detail: "Clarificação alimentar específica criada.",
      data: { pendingOperationId: 91 },
    });

    const result = await completeWhatsappIntentClarificationCallback(
      42,
      { target } as never,
      "register_food",
      new Date("2026-07-22T01:00:00.000Z"),
    );

    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(42, expect.objectContaining({
      text: target.originalText,
      entrypoint: "intentClarification.resume",
    }));
    expect(result.eventType).toBe("whatsapp.food_clarification.requested");
    expect(result.data).toEqual(expect.objectContaining({ originalTextResumed: true }));
  });

  it("Corrigir refeição vira pergunta aberta específica sem mutação", async () => {
    const result = await completeWhatsappIntentClarificationCallback(
      42,
      { target } as never,
      "correct_meal",
    );

    expect(result.eventType).toBe("whatsapp.intent_clarification.correct_meal");
    expect(result.reply).toContain("Diga exatamente o que deseja corrigir");
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
  });

  it("Consultar registros executa o resumo canônico", async () => {
    executeWhatsappTextIntentMock.mockResolvedValue({
      handled: true,
      action: "period_report",
      reply: "Resumo de hoje",
      eventType: "whatsapp.intent.period_report",
      detail: "Resumo diário consultado.",
      data: { period: "today" },
    });

    const result = await completeWhatsappIntentClarificationCallback(
      42,
      { target } as never,
      "consult_records",
      new Date("2026-07-22T01:00:00.000Z"),
    );

    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(42, expect.objectContaining({
      text: "Resumo hoje",
    }));
    expect(result.eventType).toBe("whatsapp.intent.period_report");
    expect(result.reply).toBe("Resumo de hoje");
  });

  it("Cancelar encerra sem chamar domínio ou nutrição", async () => {
    const result = await completeWhatsappIntentClarificationCallback(
      42,
      { target } as never,
      "cancel",
    );

    expect(result.eventType).toBe("whatsapp.intent_clarification.cancelled");
    expect(result.reply).toContain("Não registrei nem alterei nada");
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
  });
});
