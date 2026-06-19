import { describe, expect, it } from "vitest";
import { parseWhatsappInterpretedIntent } from "./intentSchema";

describe("whatsapp intent schema", () => {
  it("valida payload estruturado para troca de alimento", () => {
    const parsed = parseWhatsappInterpretedIntent({
      intent: "replace_food_in_meal",
      confidence: 0.86,
      sourceFood: "banana da terra",
      targetFood: "batata doce assada na air fryer",
      items: [],
      requiresConfirmation: false,
      possibleIntents: [],
    });

    expect(parsed.success).toBe(true);
  });

  it("valida pedido de sugestao de refeicao sem acao persistente", () => {
    const parsed = parseWhatsappInterpretedIntent({
      intent: "meal_suggestion",
      confidence: 0.91,
      meal: { label: "jantar", createIfMissing: false },
      items: [{ foodName: "frango", quantity: null, unit: null }],
      requiresConfirmation: false,
      possibleIntents: [],
      reason: "Usuario pediu uma proposta de refeicao, nao informou consumo realizado.",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.intent).toBe("meal_suggestion");
    expect(parsed.success && parsed.data.meal?.createIfMissing).toBe(false);
  });

  it("valida intencoes runtime do fluxo profissional-paciente", () => {
    const suggestion = parseWhatsappInterpretedIntent({
      intent: "profissional_sugere_meta",
      confidence: 0.91,
      items: [],
      requiresConfirmation: true,
      clarificationQuestion: "Aceitar, recusar ou pedir ajuste?",
      possibleIntents: ["paciente_aceita_sugestao", "paciente_recusa_sugestao", "paciente_pede_ajuste_sugestao"],
      reason: "Sugestao profissional exige pendencia e aceite do paciente.",
    });
    const confirmation = parseWhatsappInterpretedIntent({
      intent: "confirmacao_sim_nao",
      confidence: 0.82,
      items: [],
      requiresConfirmation: true,
      clarificationQuestion: "Qual sugestao voce quer confirmar?",
      possibleIntents: ["paciente_aceita_sugestao", "paciente_recusa_sugestao"],
    });

    expect(suggestion.success).toBe(true);
    expect(confirmation.success).toBe(true);
  });

  it("rejeita intencao fora do contrato", () => {
    const parsed = parseWhatsappInterpretedIntent({
      intent: "delete_everything",
      confidence: 0.99,
      items: [],
      requiresConfirmation: false,
      possibleIntents: [],
    });

    expect(parsed.success).toBe(false);
  });

  it("representa ambiguidade sem executar acao", () => {
    const parsed = parseWhatsappInterpretedIntent({
      intent: "ambiguous",
      confidence: 0.58,
      items: [],
      requiresConfirmation: true,
      clarificationQuestion: "Voce quer registrar alimento, ver refeicoes ou abrir registros?",
      possibleIntents: ["add_foods_to_meal", "list_meal_records", "open_records_link"],
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.requiresConfirmation).toBe(true);
  });
});
