import { describe, expect, it } from "vitest";
import {
  GENERIC_COFFEE_PREPARATION_ACTIONS,
  GENERIC_COFFEE_PREPARATION_QUESTION,
  isPendingGenericCoffeePreparationClarification,
  parseGenericCoffeePreparationTextAction,
} from "./intentClarificationInteraction";

function pendingTarget() {
  return {
    contractVersion: 1 as const,
    interactionId: "intent_clarification.generic" as const,
    kind: "generic_coffee_preparation" as const,
    originalText: "café da manhã: 3 xícaras de café e 1 pão francês",
    originalReceivedAt: "2026-08-13T11:00:00.000Z",
    inboundMessageId: "wamid-974",
    userTimezone: "America/Sao_Paulo",
    intentSnapshot: {
      intent: "add_foods_to_meal" as const,
      confidence: 0.95,
      date: null,
      meal: { label: "café da manhã", createIfMissing: true },
      items: [
        { foodName: "café", quantity: 3, unit: "xícaras", brand: null, preparation: null },
        { foodName: "pão francês", quantity: 1, unit: "unidade", brand: null, preparation: null },
      ],
      sourceFood: null,
      targetFood: null,
      quantity: null,
      requiresConfirmation: false,
      clarificationQuestion: null,
      possibleIntents: [],
      reason: null,
    },
    genericItemIndexes: [0],
    actions: [...GENERIC_COFFEE_PREPARATION_ACTIONS],
  };
}

describe("issue #974 - contrato de preparo do café", () => {
  it("mantém pergunta binária e opções fechadas", () => {
    expect(GENERIC_COFFEE_PREPARATION_QUESTION).toBe("Seu café foi sem açúcar ou com açúcar?");
    expect(GENERIC_COFFEE_PREPARATION_ACTIONS.map(action => action.id)).toEqual([
      "coffee_without_sugar",
      "coffee_with_sugar",
      "cancel",
    ]);
  });

  it.each([
    ["sem açúcar", "coffee_without_sugar"],
    ["puro", "coffee_without_sugar"],
    ["preto", "coffee_without_sugar"],
    ["natural", "coffee_without_sugar"],
    ["com açúcar", "coffee_with_sugar"],
    ["adoçado", "coffee_with_sugar"],
    ["açucarado", "coffee_with_sugar"],
    ["1", "coffee_without_sugar"],
    ["2", "coffee_with_sugar"],
    ["CANCELAR", "cancel"],
  ])("interpreta %s como %s", (text, expected) => {
    expect(parseGenericCoffeePreparationTextAction(text)).toBe(expected);
  });

  it("não consome resposta inválida", () => {
    expect(parseGenericCoffeePreparationTextAction("talvez")).toBeNull();
    expect(parseGenericCoffeePreparationTextAction("café com leite")).toBeNull();
  });

  it("valida o snapshot persistido com quantidade, refeição e itens companheiros", () => {
    const target = pendingTarget();
    expect(isPendingGenericCoffeePreparationClarification(target)).toBe(true);
    expect(target.genericItemIndexes).toEqual([0]);
    expect(target.intentSnapshot.meal?.label).toBe("café da manhã");
    expect(target.intentSnapshot.items).toHaveLength(2);
    expect(target.intentSnapshot.items[0]).toEqual(expect.objectContaining({
      foodName: "café",
      quantity: 3,
      unit: "xícaras",
    }));
    expect(target.intentSnapshot.items[1]).toEqual(expect.objectContaining({
      foodName: "pão francês",
      quantity: 1,
      unit: "unidade",
    }));
  });
});
