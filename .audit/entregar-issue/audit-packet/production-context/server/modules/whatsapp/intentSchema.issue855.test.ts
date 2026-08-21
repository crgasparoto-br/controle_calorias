import { describe, expect, it } from "vitest";
import { parseWhatsappInterpretedIntent } from "./intentSchema";

function payload(foodName: string) {
  return {
    intent: "add_foods_to_meal",
    confidence: 0.95,
    date: null,
    meal: { label: "Lanche", createIfMissing: true },
    items: [{ foodName, quantity: 1, unit: "porção", brand: null, preparation: null }],
    sourceFood: null,
    targetFood: null,
    quantity: null,
    requiresConfirmation: false,
    clarificationQuestion: null,
    possibleIntents: [],
    reason: "registro alimentar",
  };
}

describe("intentSchema issue #855", () => {
  it.each(["Registrar", "confirmar", "cancelar", "sim", "2"])(
    "rejeita foodName operacional isolado %s",
    foodName => {
      expect(parseWhatsappInterpretedIntent(payload(foodName)).success).toBe(false);
    },
  );

  it("mantém alimento real cujo nome contém palavra operacional", () => {
    expect(parseWhatsappInterpretedIntent(payload("Arroz para registrar no almoço")).success).toBe(true);
  });
});
