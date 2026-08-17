import { describe, expect, it } from "vitest";
import {
  buildExpectedWhatsappNegativeActual,
  runWhatsappNegativeEvaluationCase,
  validateWhatsappNegativeEvaluationCoverage,
  whatsappNegativeEvaluationCases,
} from "./negativeEvaluation";

function getCase(id: string) {
  const testCase = whatsappNegativeEvaluationCases.find(item => item.id === id);
  if (!testCase) throw new Error(`Caso negativo nao encontrado: ${id}`);
  return testCase;
}

describe("whatsapp negative evaluation", () => {
  it("cobre modalidades e fallbacks obrigatorios", () => {
    expect(validateWhatsappNegativeEvaluationCoverage()).toEqual([]);

    const ids = new Set(whatsappNegativeEvaluationCases.map(testCase => testCase.id));

    expect(ids).toEqual(new Set([
      "negative-question-banana-calories",
      "negative-report-week-chart",
      "negative-isolated-number-two",
      "negative-short-no-without-pending",
      "negative-incomplete-correction",
      "negative-image-caption-insufficient",
      "negative-audio-transcript-insufficient",
      "negative-out-of-scope-billing",
      "negative-prompt-injection-policy",
      "negative-expired-selection-multiturn",
    ]));
  });

  it("mensagem que parece alimento mas e pergunta nao pode persistir", () => {
    const testCase = getCase("negative-question-banana-calories");
    const actual = buildExpectedWhatsappNegativeActual(testCase);

    expect(runWhatsappNegativeEvaluationCase(testCase, actual)).toEqual([]);

    actual.intent.intent = "add_foods_to_meal";
    actual.action = "llm_intent_add_foods_to_meal";
    actual.persistence = "save";

    expect(runWhatsappNegativeEvaluationCase(testCase, actual)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "intent.intent", severity: "blocking" }),
      expect.objectContaining({ field: "negative.persistence_guard", severity: "blocking" }),
    ]));
  });

  it("pedido de relatorio ou grafico nao cria alimento", () => {
    const testCase = getCase("negative-report-week-chart");
    const actual = buildExpectedWhatsappNegativeActual(testCase);
    actual.persistence = "save";

    expect(runWhatsappNegativeEvaluationCase(testCase, actual)).toContainEqual(expect.objectContaining({
      field: "negative.persistence_guard",
      message: "Relatorio interpretado como alimento polui diario nutricional.",
    }));
  });

  it("numero isolado e resposta curta sem contexto pedem esclarecimento", () => {
    for (const id of ["negative-isolated-number-two", "negative-short-no-without-pending"]) {
      const testCase = getCase(id);
      const actual = buildExpectedWhatsappNegativeActual(testCase);

      expect(actual.persistence).toBe("ask_clarification");
      expect(runWhatsappNegativeEvaluationCase(testCase, actual)).toEqual([]);
    }
  });

  it("correcao incompleta exige esclarecimento e nao altera registro", () => {
    const testCase = getCase("negative-incomplete-correction");
    const actual = buildExpectedWhatsappNegativeActual(testCase);
    actual.intent.intent = "replace_food_in_meal";
    actual.persistence = "save";

    expect(runWhatsappNegativeEvaluationCase(testCase, actual)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "intent.intent", expected: "ambiguous", actual: "replace_food_in_meal" }),
      expect.objectContaining({ field: "negative.persistence_guard" }),
    ]));
  });

  it("imagem e audio insuficientes ficam sem persistencia", () => {
    for (const id of ["negative-image-caption-insufficient", "negative-audio-transcript-insufficient"]) {
      const testCase = getCase(id);
      const actual = buildExpectedWhatsappNegativeActual(testCase);

      expect(runWhatsappNegativeEvaluationCase(testCase, actual)).toEqual([]);
      expect(actual.persistence).not.toBe("save");
    }
  });

  it("prompt injection bloqueia sem alterar politica ou memoria", () => {
    const testCase = getCase("negative-prompt-injection-policy");
    const actual = buildExpectedWhatsappNegativeActual(testCase);

    expect(actual.persistence).toBe("block");
    expect(actual.action).toBe("security_guard_block");
    expect(runWhatsappNegativeEvaluationCase(testCase, actual)).toEqual([]);
  });

  it("multi-turn com pendencia expirada nao aplica selecao antiga", () => {
    const testCase = getCase("negative-expired-selection-multiturn");
    const actual = buildExpectedWhatsappNegativeActual(testCase);
    actual.action = "apply_previous_selection";
    actual.persistence = "save";

    expect(runWhatsappNegativeEvaluationCase(testCase, actual)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "action", expected: "expired_context_ask_new_selection" }),
      expect.objectContaining({ field: "negative.persistence_guard" }),
    ]));
  });
});
