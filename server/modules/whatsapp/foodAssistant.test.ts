import { describe, expect, it } from "vitest";

import {
  executeConfirmedWhatsAppFoodSuggestion,
  executeWhatsAppFoodAssistantIntent,
} from "./foodAssistant";

describe("executeWhatsAppFoodAssistantIntent", () => {
  it("responde pedidos naturais de orientação alimentar sem depender de refeição", () => {
    const result = executeWhatsAppFoodAssistantIntent("O que posso comer no jantar?");

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "food_assistant",
      eventType: "whatsapp.intent.food_assistant",
      data: { context: "dinner" },
      reply: expect.stringContaining("Sugestão alimentar"),
    }));
    expect(result?.reply).toContain("Nada foi registrado como consumo");
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

  it.each([
    "me sugira uma refeição",
    "proposta de refeição para o jantar",
    "monte um almoço com poucas calorias",
    "quero uma opção de café da manhã",
    "sugira um jantar dentro da minha meta",
    "me indique algo com frango para o almoço",
  ])("classifica linguagem consultiva como sugestao: %s", text => {
    const result = executeWhatsAppFoodAssistantIntent(text);

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "food_assistant",
      eventType: "whatsapp.intent.food_assistant",
      reply: expect.stringContaining("Nada foi registrado como consumo"),
    }));
  });

  it.each([
    "almoço com frango e arroz",
    "jantar leve com ovo",
    "café da manhã com banana",
  ])("não produz uma segunda clarificação para descrição ambígua: %s", text => {
    expect(executeWhatsAppFoodAssistantIntent(text)).toBeNull();
  });

  it("gera sugestão confirmada sem persistir consumo", () => {
    const result = executeConfirmedWhatsAppFoodSuggestion(
      "jantar com arroz, feijão e frango"
    );

    expect(result.data).toEqual({ context: "dinner" });
    expect(result.reply).toContain("Nada foi registrado como consumo");
  });

  it("ignora textos comuns de refeição para manter o fluxo de inferência", () => {
    expect(executeWhatsAppFoodAssistantIntent("almocei arroz, feijão e frango")).toBeNull();
  });
});
