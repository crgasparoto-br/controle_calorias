import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  requestClarification: vi.fn(),
}));

vi.mock("./confirmedMealRegistration", () => ({
  executeConfirmedWhatsAppMealRegistration: mocks.register,
}));

vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification: mocks.requestClarification,
}));

import {
  handleCoffeeSugarRegistrationIntent,
  isCoffeeSugarRegistrationText,
} from "./coffeeSugarIntent";

describe("registro de café com complementos coordenados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.register.mockResolvedValue({
      status: "details_needed",
      prompt: "Informe a quantidade de açúcar.",
      detail: "Componente ausente.",
    });
    mocks.requestClarification.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "Informe somente a quantidade de açúcar.",
      eventType: "whatsapp.food_clarification.requested",
      detail: "Pendência persistida.",
    });
  });

  it("classifica a preparação coordenada como registro de café adoçado", () => {
    expect(isCoffeeSugarRegistrationText(
      "1 xícara de café com leite e açúcar",
    )).toBe(true);
  });

  it("não intercepta uma descrição iniciada pelo nome da refeição", () => {
    expect(isCoffeeSugarRegistrationText(
      "café da manhã com pão e café com leite e açúcar",
    )).toBe(false);
  });

  it("preserva o texto original ao abrir a clarificação persistente", async () => {
    const receivedAt = new Date("2026-07-24T12:00:00.000Z");
    const result = await handleCoffeeSugarRegistrationIntent({
      userId: 903,
      text: "1 xícara de café com leite e açúcar",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "wamid-coordinated-registration",
    });

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      registrationText: "1 xícara de café com leite e açúcar",
      originalText: "1 xícara de café com leite e açúcar",
    }));
    expect(mocks.requestClarification).toHaveBeenCalledWith(expect.objectContaining({
      originalFoodText: "1 xícara de café com leite e açúcar",
      operation: expect.objectContaining({ kind: "register" }),
      messageId: "wamid-coordinated-registration",
    }));
  });
});
