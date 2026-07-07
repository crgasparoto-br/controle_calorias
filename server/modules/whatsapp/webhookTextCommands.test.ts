import { describe, expect, it, vi } from "vitest";

const relabelUserMealsMock = vi.fn(async () => []);
const listUserMealsMock = vi.fn(async () => []);

vi.mock("../../db", () => ({
  relabelUserMeals: relabelUserMealsMock,
  listUserMeals: listUserMealsMock,
}));

const {
  buildWaterLogReply,
  buildWeightLogReply,
  detectWaterLogFromMessage,
  detectWeightLogFromMessage,
  detectWhatsAppAction,
  handleWhatsAppAction,
} = await import("./webhookTextCommands");

function textMessage(body: string) {
  return { text: { body } };
}

describe("webhookTextCommands", () => {
  describe("detectWaterLogFromMessage", () => {
    it("reconhece quantidade em mililitros", () => {
      expect(detectWaterLogFromMessage(textMessage("bebi 300ml de agua"))).toEqual({ amountMl: 300 });
    });

    it("reconhece quantidade em litros", () => {
      expect(detectWaterLogFromMessage(textMessage("1,5 litros de agua"))).toEqual({ amountMl: 1500 });
    });

    it("ignora mensagens que misturam comida com água", () => {
      expect(detectWaterLogFromMessage(textMessage("300ml de agua e um pao"))).toBeNull();
    });

    it("ignora mensagens com mídia anexada", () => {
      expect(detectWaterLogFromMessage({ text: { body: "300ml de agua" }, image: { id: "img" } })).toBeNull();
    });
  });

  describe("detectWeightLogFromMessage", () => {
    it("reconhece peso em kg", () => {
      expect(detectWeightLogFromMessage(textMessage("meu peso hoje é 82,5kg"))).toEqual({ weightKg: 82.5 });
    });

    it("ignora valores fora da faixa aceitável", () => {
      expect(detectWeightLogFromMessage(textMessage("pesei 10kg"))).toBeNull();
    });
  });

  describe("reply builders", () => {
    it("formata mensagem de água com horário em São Paulo", () => {
      const reply = buildWaterLogReply(300, new Date("2026-04-20T11:14:00-03:00"));
      expect(reply).toContain("*Água registrada*");
      expect(reply).toContain("Registrei 300 ml de água às 11:14.");
    });

    it("formata mensagem de peso com horário em São Paulo", () => {
      const reply = buildWeightLogReply(82.5, new Date("2026-04-20T11:14:00-03:00"));
      expect(reply).toContain("*Peso atualizado*");
      expect(reply).toContain("Atualizei seu peso atual para 82.5 kg às 11:14.");
    });
  });

  describe("detectWhatsAppAction", () => {
    it("reconhece comando de reclassificação de refeição", () => {
      const action = detectWhatsAppAction(textMessage("Mudar a refeição lanche para café da manhã"));
      expect(action).toEqual({
        kind: "reclassify_recent_meals",
        fromMealLabel: "Lanche",
        toMealLabel: "Café da manhã",
      });
    });

    it("ignora quando origem e destino são a mesma refeição", () => {
      expect(detectWhatsAppAction(textMessage("Mudar a refeição lanche para lanche"))).toBeNull();
    });
  });

  describe("handleWhatsAppAction", () => {
    it("pede esclarecimento quando não há refeições recentes compatíveis", async () => {
      listUserMealsMock.mockResolvedValueOnce([]);
      const result = await handleWhatsAppAction({ kind: "reclassify_recent_meals", fromMealLabel: "Lanche", toMealLabel: "Café da manhã" }, 42);
      expect(result).toEqual(expect.objectContaining({
        handled: true,
        eventType: "whatsapp.action_clarification_needed",
      }));
    });
  });
});
