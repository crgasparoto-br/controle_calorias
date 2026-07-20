import { describe, expect, it } from "vitest";
import { classifyWhatsappMessageDeterministically } from "./intentInterpreter";
import { detectWhatsappDeleteIntent } from "./deleteIntent";

describe("detectWhatsappDeleteIntent", () => {
  it.each([
    "exclua refeição fotografada",
    "remover refeição",
    "apagar o último registro",
  ])("bloqueia exclusao de refeicao antes do fallback nutricional: %s", text => {
    const detection = detectWhatsappDeleteIntent(text);

    expect(detection).toEqual(expect.objectContaining({
      kind: "delete_meal",
      eventType: "whatsapp.intent.delete_meal_clarification_needed",
    }));
    expect(detection?.reply).toContain("preciso confirmar qual registro");
    expect(detection?.reply).toContain("Não excluí nada");
    expect(detection?.reply).toContain("não registrei nenhum alimento novo");
  });

  it.each([
    "excluir alimento",
    "remova esse alimento",
    "tirar o item da refeição",
  ])("bloqueia exclusao de alimento antes do fallback nutricional: %s", text => {
    const detection = detectWhatsappDeleteIntent(text);

    expect(detection).toEqual(expect.objectContaining({
      kind: "delete_food_from_meal",
      eventType: "whatsapp.intent.delete_food_clarification_needed",
    }));
    expect(detection?.reply).toContain("remover um alimento");
    expect(detection?.reply).toContain("Não registrei nenhum alimento novo");
  });

  it.each([
    ["Exclua o bife entrecote", "bife entrecote"],
    ["Remova a banana", "banana"],
    ["Tire o queijo Minas", "queijo minas"],
    ["Retire o queijo", "queijo"],
  ])("detecta comando com nome provavel de alimento: %s", (text, targetFoodName) => {
    expect(detectWhatsappDeleteIntent(text)).toEqual(expect.objectContaining({
      kind: "delete_food_from_meal",
      targetFoodName,
    }));
  });

  it("separa alimento do contexto de refeicao", () => {
    expect(detectWhatsappDeleteIntent("Remover o arroz do almoço")).toEqual(expect.objectContaining({
      kind: "delete_food_from_meal",
      targetFoodName: "arroz",
      targetMealLabel: "almoco",
      contextReference: "named_meal",
    }));
  });

  it("mantem refeicao nomeada como exclusao da refeicao inteira", () => {
    expect(detectWhatsappDeleteIntent("Apagar o almoço")).toEqual(expect.objectContaining({
      kind: "delete_meal",
      targetMealLabel: "almoco",
      contextReference: "named_meal",
    }));
  });

  it("marca pronome demonstrativo como referencia conversacional", () => {
    expect(detectWhatsappDeleteIntent("Apagar essa refeição")).toEqual(expect.objectContaining({
      kind: "delete_meal",
      contextReference: "conversation",
    }));
  });

  it.each([
    ["Não tem queijo", "queijo", undefined],
    ["não tinha banana", "banana", undefined],
    ["Não havia arroz integral", "arroz integral", undefined],
    ["Sem QUEIJO MINAS", "queijo minas", undefined],
    ["Sem feijão na refeição", "feijao", undefined],
    ["Não tem queijo no jantar", "queijo", "jantar"],
  ])("interpreta ausencia explicita como pedido de exclusao: %s", (text, targetFoodName, targetMealLabel) => {
    expect(detectWhatsappDeleteIntent(text)).toEqual(expect.objectContaining({
      kind: "delete_food_from_meal",
      targetFoodName,
      targetMealLabel,
      eventType: "whatsapp.intent.delete_food_clarification_needed",
    }));
  });

  it("nao converte frase ambigua em exclusao", () => {
    expect(detectWhatsappDeleteIntent("O queijo está errado")).toBeNull();
  });

  it("nao captura ajuste parcial de quantidade como exclusao", () => {
    expect(detectWhatsappDeleteIntent("tirar 30g de arroz")).toBeNull();
    expect(detectWhatsappDeleteIntent("Remova 20g do bife entrecote")).toBeNull();
    expect(detectWhatsappDeleteIntent("Retire 15g do queijo")).toBeNull();
  });

  it("nao captura registro alimentar normal", () => {
    expect(detectWhatsappDeleteIntent("adicionar 100g de arroz no almoço")).toBeNull();
  });
});

describe("classifyWhatsappMessageDeterministically delete intents", () => {
  it("classifica comando destrutivo de refeicao sem virar alimento estimado", () => {
    const intent = classifyWhatsappMessageDeterministically("exclua refeição fotografada");

    expect(intent.intent).toBe("delete_meal");
    expect(intent.items).toEqual([]);
    expect(intent.requiresConfirmation).toBe(true);
    expect(intent.clarificationQuestion).toContain("preciso confirmar qual registro");
  });

  it("classifica comando destrutivo de alimento sem virar alimento estimado", () => {
    const intent = classifyWhatsappMessageDeterministically("remova esse alimento");

    expect(intent.intent).toBe("delete_food_from_meal");
    expect(intent.items).toEqual([]);
    expect(intent.requiresConfirmation).toBe(true);
  });

  it("classifica negacao explicita de alimento como exclusao com confirmacao", () => {
    const intent = classifyWhatsappMessageDeterministically("Não tem queijo");

    expect(intent.intent).toBe("delete_food_from_meal");
    expect(intent.items).toEqual([]);
    expect(intent.requiresConfirmation).toBe(true);
  });

  it("classifica alimento com refeicao como exclusao do item, nao da refeicao", () => {
    const intent = classifyWhatsappMessageDeterministically("Remover o arroz do almoço");

    expect(intent.intent).toBe("delete_food_from_meal");
    expect(intent.items).toEqual([]);
    expect(intent.requiresConfirmation).toBe(true);
  });
});
