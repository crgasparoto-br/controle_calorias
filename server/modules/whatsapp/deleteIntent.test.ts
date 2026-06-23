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

  it("nao captura ajuste parcial de quantidade como exclusao", () => {
    expect(detectWhatsappDeleteIntent("tirar 30g de arroz")).toBeNull();
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
});
