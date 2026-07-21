import { beforeEach, describe, expect, it, vi } from "vitest";

const executeWhatsappTextIntentMock = vi.fn();
vi.mock("./intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));

const {
  buildIntentClarificationActions,
  buildWhatsappIntentClarificationReply,
  completeWhatsappIntentClarificationCallback,
  isGenericIntentClarificationResult,
  parseIntentClarificationTextAction,
} = await import("./intentClarificationInteraction");
const { WHATSAPP_GENERIC_CLARIFICATION_MESSAGE } = await import("./replyMessages");

describe("clarificação genérica como decisão fechada (issue #858)", () => {
  beforeEach(() => {
    executeWhatsappTextIntentMock.mockReset();
  });

  it("oferece as três ações objetivas mais Cancelar, em lista (4 ações)", () => {
    const actions = buildIntentClarificationActions();
    expect(actions.map(action => action.label)).toEqual([
      "Registrar alimento",
      "Corrigir refeição",
      "Consultar registros",
      "Cancelar",
    ]);
    const reply = buildWhatsappIntentClarificationReply(5, "O que você quer fazer?");
    expect(reply.messages[0]).toMatchObject({ type: "list" });
  });

  it("detecta o resultado de clarificação genérica do router/LLM", () => {
    expect(isGenericIntentClarificationResult({ reply: `Preciso de uma informação\n\n${WHATSAPP_GENERIC_CLARIFICATION_MESSAGE}` })).toBe(true);
    expect(isGenericIntentClarificationResult({ reply: "Registrei 100 g de arroz." })).toBe(false);
    expect(isGenericIntentClarificationResult(null)).toBe(false);
  });

  it("resolve texto equivalente ao callback: número, rótulo e cancelamento", () => {
    expect(parseIntentClarificationTextAction("1")).toBe("register_food");
    expect(parseIntentClarificationTextAction("2")).toBe("correct_meal");
    expect(parseIntentClarificationTextAction("3")).toBe("consult_records");
    expect(parseIntentClarificationTextAction("registrar")).toBe("register_food");
    expect(parseIntentClarificationTextAction("corrigir refeição")).toBe("correct_meal");
    expect(parseIntentClarificationTextAction("consultar")).toBe("consult_records");
    expect(parseIntentClarificationTextAction("cancelar")).toBe("cancel");
    expect(parseIntentClarificationTextAction("comi 2 ovos")).toBeNull();
    expect(parseIntentClarificationTextAction("7")).toBeNull();
  });

  it("registrar alimento vira pergunta aberta preservando a mensagem original, sem persistir", async () => {
    const result = await completeWhatsappIntentClarificationCallback(
      1,
      { target: { kind: "intent_clarification", originalText: "registrar" } },
      "register_food",
    );
    expect(result.reply).toContain("quantidade");
    expect(result.reply).toContain('"registrar"');
    expect(result.eventType).toBe("whatsapp.intent_clarification.register_food");
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
  });

  it("corrigir refeição vira pergunta aberta específica", async () => {
    const result = await completeWhatsappIntentClarificationCallback(
      1,
      { target: { kind: "intent_clarification", originalText: "" } },
      "correct_meal",
    );
    expect(result.eventType).toBe("whatsapp.intent_clarification.correct_meal");
    expect(result.reply).toContain("corrigir");
  });

  it("consultar registros reutiliza o serviço existente de resumos", async () => {
    executeWhatsappTextIntentMock.mockResolvedValue({ reply: "Resumo do dia: 1200 kcal", action: "period_report", data: { mealCount: 2 } });
    const result = await completeWhatsappIntentClarificationCallback(
      1,
      { target: { kind: "intent_clarification", originalText: "consultar" } },
      "consult_records",
    );
    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(1, expect.objectContaining({ text: "Resumo hoje" }));
    expect(result.reply).toContain("Resumo do dia");
  });

  it("cancelar encerra sem persistência", async () => {
    const result = await completeWhatsappIntentClarificationCallback(
      1,
      { target: { kind: "intent_clarification", originalText: "registrar" } },
      "cancel",
    );
    expect(result.eventType).toBe("whatsapp.intent_clarification.cancelled");
    expect(result.reply).toContain("Não registrei nada");
  });

  it("ação desconhecida responde indisponibilidade sem alcançar o pipeline nutricional", async () => {
    const result = await completeWhatsappIntentClarificationCallback(
      1,
      { target: { kind: "intent_clarification", originalText: "" } },
      "explodir",
    );
    expect(result.eventType).toBe("whatsapp.intent_clarification.unknown_action");
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
  });
});
