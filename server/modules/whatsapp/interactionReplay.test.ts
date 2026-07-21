import { describe, expect, it } from "vitest";
import {
  classifyWhatsappPendingTextResponse,
  rebuildWhatsappPendingInteractionReply,
} from "./interactionReplay";

const deleteConfirmation = {
  id: 1,
  type: "delete",
  target: { kind: "delete_meal", mealId: 10, mealLabel: "Almoço", mealOccurredAt: new Date().toISOString() },
};

const deleteSelection = {
  id: 2,
  type: "delete",
  target: {
    kind: "selection",
    targetFoodName: "pão",
    candidates: [
      { kind: "delete_food_from_meal", mealId: 10, mealLabel: "Almoço", mealOccurredAt: new Date().toISOString(), itemIndex: 0, itemName: "Pão francês" },
      { kind: "delete_food_from_meal", mealId: 11, mealLabel: "Lanche", mealOccurredAt: new Date().toISOString(), itemIndex: 1, itemName: "Pão de queijo" },
    ],
  },
};

const scopeConfirmation = {
  id: 3,
  type: "confirmation",
  target: {
    action: { kind: "reclassify_recent_meals", fromMealLabel: "Lanche", toMealLabel: "Jantar" },
    mealIds: [1],
    allMealIds: [1, 2],
    summary: "Lanche → Jantar",
    decision: "reclassify_scope",
  },
};

const intentClarification = {
  id: 4,
  type: "intent_clarification",
  target: { kind: "intent_clarification", originalText: "registrar" },
};

describe("classificação de resposta textual frente à pendência (issue #858)", () => {
  it("resposta válida resolve a pendência pela cadeia existente", () => {
    expect(classifyWhatsappPendingTextResponse(deleteConfirmation, "sim")).toBe("resolves");
    expect(classifyWhatsappPendingTextResponse(deleteConfirmation, "cancelar")).toBe("resolves");
    expect(classifyWhatsappPendingTextResponse(deleteSelection, "2")).toBe("resolves");
    expect(classifyWhatsappPendingTextResponse(deleteSelection, "cancelar")).toBe("resolves");
    expect(classifyWhatsappPendingTextResponse(intentClarification, "1")).toBe("resolves");
    expect(classifyWhatsappPendingTextResponse(intentClarification, "cancelar")).toBe("resolves");
  });

  it("palavra de comando isolada incompatível é resposta inválida (não vira alimento)", () => {
    expect(classifyWhatsappPendingTextResponse(deleteConfirmation, "registrar")).toBe("invalid_response");
    expect(classifyWhatsappPendingTextResponse(deleteSelection, "registrar")).toBe("invalid_response");
  });

  it("índice fora da faixa é resposta inválida", () => {
    expect(classifyWhatsappPendingTextResponse(deleteSelection, "5")).toBe("invalid_response");
  });

  it("comando completo novo é não relacionado e não consome a pendência", () => {
    expect(classifyWhatsappPendingTextResponse(deleteConfirmation, "registrar 100 g de arroz")).toBe("unrelated");
    expect(classifyWhatsappPendingTextResponse(deleteSelection, "comi 2 ovos no almoço")).toBe("unrelated");
  });

  it("'sim' é ambíguo para decisão de escopo de reclassificação e reapresenta", () => {
    expect(classifyWhatsappPendingTextResponse(scopeConfirmation, "sim")).toBe("invalid_response");
    expect(classifyWhatsappPendingTextResponse(scopeConfirmation, "apenas")).toBe("resolves");
    expect(classifyWhatsappPendingTextResponse(scopeConfirmation, "todos")).toBe("resolves");
    expect(classifyWhatsappPendingTextResponse(scopeConfirmation, "cancelar")).toBe("resolves");
  });

  it("período: hoje/ontem/semana/mês resolvem; palavra isolada incompatível reapresenta", () => {
    const pending = { id: 9, type: "period_report_clarification", target: { kind: "period_report" } };
    expect(classifyWhatsappPendingTextResponse(pending, "ontem")).toBe("resolves");
    expect(classifyWhatsappPendingTextResponse(pending, "registrar")).toBe("invalid_response");
    expect(classifyWhatsappPendingTextResponse(pending, "comi pão")).toBe("unrelated");
  });

  it("tipo desconhecido nunca dispara reapresentação", () => {
    expect(classifyWhatsappPendingTextResponse({ id: 9, type: "professional_access", target: {} }, "registrar")).toBe("unrelated");
  });
});

describe("reconstrução da interação a partir da pendência persistida", () => {
  it("confirmação de exclusão reapresenta os mesmos botões Confirmar/Cancelar", () => {
    const replay = rebuildWhatsappPendingInteractionReply(deleteConfirmation);
    expect(replay).not.toBeNull();
    const message = replay!.interactiveReply!.messages[0] as { type: string; buttons: Array<{ title: string }> };
    expect(message.type).toBe("buttons");
    expect(message.buttons.map(button => button.title)).toEqual(["Confirmar", "Cancelar"]);
  });

  it("seleção de exclusão com dois candidatos reapresenta três botões (2 + Cancelar)", () => {
    const replay = rebuildWhatsappPendingInteractionReply(deleteSelection);
    const message = replay!.interactiveReply!.messages[0] as { type: string; buttons: Array<{ title: string }> };
    expect(message.type).toBe("buttons");
    expect(message.buttons).toHaveLength(3);
    expect(message.buttons[2].title).toBe("Cancelar");
    expect(replay!.reply).toContain("Pão francês");
    expect(replay!.reply).toContain("CANCELAR");
  });

  it("decisão de escopo reapresenta os três botões na mesma ordem", () => {
    const replay = rebuildWhatsappPendingInteractionReply(scopeConfirmation);
    const message = replay!.interactiveReply!.messages[0] as { type: string; buttons: Array<{ title: string }> };
    expect(message.type).toBe("buttons");
    expect(message.buttons.map(button => button.title)).toEqual(["Só compatíveis", "Todos recentes", "Cancelar"]);
    expect(replay!.reply).toContain("Lanche → Jantar");
  });

  it("clarificação genérica reapresenta a lista com as quatro ações e preserva a mensagem original", () => {
    const replay = rebuildWhatsappPendingInteractionReply(intentClarification);
    const message = replay!.interactiveReply!.messages[0] as { type: string; sections: Array<{ rows: Array<{ title: string }> }> };
    expect(message.type).toBe("list");
    const titles = message.sections.flatMap(section => section.rows.map(row => row.title));
    expect(titles).toEqual(["Registrar alimento", "Corrigir refeição", "Consultar registros", "Cancelar"]);
    expect(replay!.reply).toContain("registrar");
  });

  it("período reapresenta a lista com os quatro períodos e Cancelar", () => {
    const replay = rebuildWhatsappPendingInteractionReply({ id: 9, type: "period_report_clarification", target: { kind: "period_report" } });
    const message = replay!.interactiveReply!.messages[0] as { type: string; sections: Array<{ rows: Array<{ title: string }> }> };
    expect(message.type).toBe("list");
    const titles = message.sections.flatMap(section => section.rows.map(row => row.title));
    expect(titles).toEqual(["Hoje", "Ontem", "Esta semana", "Este mês", "Cancelar"]);
  });

  it("tipo sem reconstrução por target retorna null", () => {
    expect(rebuildWhatsappPendingInteractionReply({ id: 9, type: "professional_access", target: { accessId: 1 } })).toBeNull();
  });
});
