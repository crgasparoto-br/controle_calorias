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
