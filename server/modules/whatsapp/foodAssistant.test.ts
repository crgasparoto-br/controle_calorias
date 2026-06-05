import { describe, expect, it } from "vitest";

import { executeWhatsAppFoodAssistantIntent } from "./foodAssistant";

describe("executeWhatsAppFoodAssistantIntent", () => {
  it("responde pedidos explícitos do assistente alimentar sem depender de refeição", () => {
    const result = executeWhatsAppFoodAssistantIntent("Assistente alimentar, o que posso comer no jantar?");

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "food_assistant",
      eventType: "whatsapp.intent.food_assistant",
      data: { context: "dinner" },
      reply: expect.stringContaining("Assistente alimentar"),
    }));
    expect(result?.reply).toContain("Para registrar uma refeição");
  });

  it("reconhece pedidos de ajuda para escolher lanche", () => {
    const result = executeWhatsAppFoodAssistantIntent("Me ajuda a escolher um lanche da tarde");

    expect(result).toEqual(expect.objectContaining({
      action: "food_assistant",
      data: { context: "snack" },
      reply: expect.stringContaining("Iogurte natural com fruta"),
    }));
  });

  it("ignora textos comuns de refeição para manter o fluxo de inferência", () => {
    expect(executeWhatsAppFoodAssistantIntent("almocei arroz, feijão e frango")).toBeNull();
  });
});
