import { describe, expect, it } from "vitest";
import { classifyWhatsappMessageDeterministically } from "./intentInterpreter";

describe("classifyWhatsappMessageDeterministically", () => {
  it("interpreta troca de alimento com variacao de nome registrado", () => {
    const intent = classifyWhatsappMessageDeterministically("Não é banana da terra e sim batata doce assada na air fryer");

    expect(intent).toEqual(expect.objectContaining({
      intent: "replace_food_in_meal",
      sourceFood: "banana da terra",
      targetFood: "batata doce assada na air fryer",
      requiresConfirmation: false,
    }));
  });

  it("interpreta inclusao de alimentos em refeicao ainda inexistente", () => {
    const intent = classifyWhatsappMessageDeterministically(
      "Inclua no café da manhã: 2 fatias de pão de forma, 50g de tahine com salsinha e Café coado",
    );

    expect(intent.intent).toBe("add_foods_to_meal");
    expect(intent.meal).toEqual({ label: "café da manhã", createIfMissing: true });
    expect(intent.items.map(item => item.foodName)).toEqual([
      "pão de forma",
      "tahine com salsinha",
      "Café coado",
    ]);
    expect(intent.requiresConfirmation).toBe(false);
  });

  it("classifica refeicoes registradas como consulta", () => {
    const intent = classifyWhatsappMessageDeterministically("refeições registradas");

    expect(intent.intent).toBe("list_meal_records");
    expect(intent.confidence).toBeGreaterThan(0.8);
  });

  it("pede esclarecimento para texto curto ambiguo", () => {
    const intent = classifyWhatsappMessageDeterministically("registro");

    expect(intent.intent).toBe("ambiguous");
    expect(intent.requiresConfirmation).toBe(true);
    expect(intent.possibleIntents).toContain("add_foods_to_meal");
    expect(intent.possibleIntents).toContain("list_meal_records");
  });

  it("pede quantidade quando a intencao provavel e cadastrar alimento", () => {
    const intent = classifyWhatsappMessageDeterministically("banana");

    expect(intent.intent).toBe("add_foods_to_meal");
    expect(intent.requiresConfirmation).toBe(true);
    expect(intent.clarificationQuestion).toContain("quantidade");
  });
});
