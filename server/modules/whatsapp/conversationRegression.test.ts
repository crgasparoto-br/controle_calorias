import { describe, expect, it } from "vitest";
import {
  buildExpectedWhatsappConversationActual,
  runWhatsappConversationRegressionCase,
  validateWhatsappConversationRegressionCoverage,
  whatsappConversationRegressionCases,
} from "./conversationRegression";

function getCase(id: string) {
  const testCase = whatsappConversationRegressionCases.find(item => item.id === id);
  if (!testCase) throw new Error(`Conversa de regressao nao encontrada: ${id}`);
  return testCase;
}

describe("whatsapp conversation regression", () => {
  it("cobre cenarios multi-turn obrigatorios", () => {
    expect(validateWhatsappConversationRegressionCoverage()).toEqual([]);
    expect(whatsappConversationRegressionCases.map(testCase => testCase.id)).toEqual([
      "conversation-clarify-food-quantity",
      "conversation-option-selection",
      "conversation-correction-after-record",
      "conversation-cancel-pending",
      "conversation-relative-date-timezone",
      "conversation-expired-pending-selection",
    ]);
  });

  it("valida pendencia criada e consumida entre turnos", () => {
    const testCase = getCase("conversation-clarify-food-quantity");
    const actual = buildExpectedWhatsappConversationActual(testCase);

    expect(runWhatsappConversationRegressionCase(testCase, actual)).toEqual([]);

    actual.turns[1].pendingBefore = null;

    expect(runWhatsappConversationRegressionCase(testCase, actual)).toContainEqual(expect.objectContaining({
      field: "turn-answer-quantity.pendingBefore",
      severity: "blocking",
    }));
  });

  it("falha quando selecao por numero aplica pendencia errada", () => {
    const testCase = getCase("conversation-option-selection");
    const actual = buildExpectedWhatsappConversationActual(testCase);
    actual.turns[1].pendingBefore = {
      id: "pending-other-options",
      kind: "option_selection",
      status: "active",
      referenceId: "other-options",
    };

    expect(runWhatsappConversationRegressionCase(testCase, actual)).toContainEqual(expect.objectContaining({
      field: "turn-select-option.pendingBefore",
      message: "Estado pendente antes do turno mudou.",
    }));
  });

  it("valida estado final dos registros afetados", () => {
    const testCase = getCase("conversation-correction-after-record");
    const actual = buildExpectedWhatsappConversationActual(testCase);
    actual.finalState.records = [{
      ...actual.finalState.records[0],
      foods: ["batata"],
      status: "updated",
    }];

    expect(runWhatsappConversationRegressionCase(testCase, actual)).toContainEqual(expect.objectContaining({
      field: "finalState.records",
      severity: "blocking",
    }));
  });

  it("garante que cancelamento encerra pendencia sem salvar", () => {
    const testCase = getCase("conversation-cancel-pending");
    const actual = buildExpectedWhatsappConversationActual(testCase);

    expect(runWhatsappConversationRegressionCase(testCase, actual)).toEqual([]);
    expect(actual.finalState.records).toEqual([]);
    expect(actual.finalState.pending).toBeNull();
  });

  it("mantem data relativa no fuso configurado do usuario", () => {
    const testCase = getCase("conversation-relative-date-timezone");
    const actual = buildExpectedWhatsappConversationActual(testCase);

    expect(runWhatsappConversationRegressionCase(testCase, actual)).toEqual([]);
    expect(actual.finalState.records[0]).toEqual(expect.objectContaining({
      localDate: "2026-06-15",
      timezone: "America/Sao_Paulo",
    }));
  });

  it("bloqueia aplicacao de selecao antiga quando pendencia expirou", () => {
    const testCase = getCase("conversation-expired-pending-selection");
    const actual = buildExpectedWhatsappConversationActual(testCase);
    actual.turns[0].output.action = "resolve_food_option_selection";
    actual.turns[0].output.persistence = "save";
    actual.finalState.records = [{
      id: "meal-from-expired-option",
      kind: "meal",
      foods: ["opcao antiga"],
      mealLabel: null,
      localDate: "2026-06-16",
      timezone: "America/Sao_Paulo",
      status: "created",
    }];

    expect(runWhatsappConversationRegressionCase(testCase, actual)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "action", expected: "expired_context_ask_new_selection" }),
      expect.objectContaining({ field: "persistence.no_action_guard" }),
      expect.objectContaining({ field: "finalState.records" }),
    ]));
  });
});
