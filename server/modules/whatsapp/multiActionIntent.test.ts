import { describe, expect, it } from "vitest";

import { executeWhatsappMultiActionIntent } from "./multiActionIntent";

describe("executeWhatsappMultiActionIntent", () => {
  it("decompoe multiplas trocas preservando ordem e modo transacional", () => {
    const result = executeWhatsappMultiActionIntent({
      text: "Não é peixe é frango, não é mandioquinha é batata doce",
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "multi_action_confirmation_needed",
      eventType: "whatsapp.multi_action.confirmation_needed",
      data: expect.objectContaining({
        actionCount: 2,
        transactionMode: "all_or_nothing",
        partialSuccessAllowed: false,
      }),
    }));
    expect(result?.data.extractedActions).toEqual([
      expect.objectContaining({
        order: 1,
        actionType: "trocar_alimento",
        sourceFood: "peixe",
        targetFood: "frango",
        validationStatus: "needs_confirmation",
      }),
      expect.objectContaining({
        order: 2,
        actionType: "trocar_alimento",
        sourceFood: "mandioquinha",
        targetFood: "batata doce",
        validationStatus: "needs_confirmation",
      }),
    ]);
  });

  it("decompoe multiplas remocoes em uma unica resposta segura", () => {
    const result = executeWhatsappMultiActionIntent({
      text: "remove a cerveja e tira o feijão",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "multi_action_confirmation_needed",
      data: expect.objectContaining({ actionCount: 2 }),
    }));
    expect(result?.data.extractedActions).toEqual([
      expect.objectContaining({ actionType: "excluir_alimento", itemName: "cerveja" }),
      expect.objectContaining({ actionType: "excluir_alimento", itemName: "feijão" }),
    ]);
  });

  it("mantem acoes posteriores quando uma mistura precisa de esclarecimento", () => {
    const result = executeWhatsappMultiActionIntent({
      text: "adiciona arroz, troca o frango por peixe e remove a cerveja",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "multi_action_clarification_needed",
      data: expect.objectContaining({
        actionCount: 3,
        validationSummary: expect.objectContaining({
          pendingConfirmationCount: 2,
          needsClarificationCount: 1,
        }),
      }),
    }));
    expect(result?.data.extractedActions.map(action => action.actionType)).toEqual([
      "adicionar_alimento",
      "trocar_alimento",
      "excluir_alimento",
    ]);
  });

  it("preserva lista alimentar antes de uma remocao posterior", () => {
    const result = executeWhatsappMultiActionIntent({
      text: "no almoço foi arroz, feijão, frango; tira o feijão",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "multi_action_clarification_needed",
      data: expect.objectContaining({ actionCount: 2 }),
    }));
    expect(result?.data.extractedActions).toEqual([
      expect.objectContaining({
        actionType: "adicionar_alimento",
        itemNames: ["arroz", "feijão", "frango"],
        mealLabel: "almoço",
      }),
      expect.objectContaining({
        actionType: "excluir_alimento",
        itemName: "feijão",
      }),
    ]);
  });

  it("ignora mensagens com apenas uma acao para manter o fluxo atual", () => {
    expect(executeWhatsappMultiActionIntent({ text: "troca arroz por batata" })).toBeNull();
  });
});
