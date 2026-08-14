import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmed = vi.fn();
const quantity = vi.fn();
const structured = vi.fn();
vi.mock("./confirmedMealRegistration", () => ({ executeConfirmedWhatsAppMealRegistration: confirmed }));
vi.mock("./foodQuantityClarification", () => ({ requestWhatsappCaloricComplementQuantityClarification: quantity }));
vi.mock("./structuredCoffeeIntentActions", () => ({ tryExecuteWhatsappStructuredCoffeeIntent: structured }));

const { handleCoffeeSugarRegistrationIntent, isCoffeeSugarRegistrationText } = await import("./coffeeSugarIntent");
const receivedAt = new Date("2026-08-13T13:00:00.000Z");

describe("generic coffee precedence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    structured.mockResolvedValue({ matched: true, result: { handled: true, action: "clarification_needed", reply: "clarify coffee", eventType: "coffee.clarify", detail: "persisted" } });
  });

  it.each(["cafe", "3 xicaras de cafe", "adicionar 3 xicaras de cafe ao cafe da manha"])("intercepts %s", text => {
    expect(isCoffeeSugarRegistrationText(text)).toBe(true);
  });

  it.each(["3 xicaras de cafe sem acucar", "cafe preto", "3 xicaras de cafe com leite", "cafe com mel", "adicionar 1 pao ao cafe da manha", "quantas calorias tem cafe?", "remover cafe"])("does not broaden to %s", text => {
    expect(isCoffeeSugarRegistrationText(text)).toBe(false);
  });

  it("clarifies before confirmed registration", async () => {
    const result = await handleCoffeeSugarRegistrationIntent({ userId: 1, text: "adicionar 3 xicaras de cafe ao cafe da manha", receivedAt, userTimezone: "America/Sao_Paulo", messageId: "msg-1" });
    expect(result.action).toBe("clarification_needed");
    expect(structured).toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();
    expect(quantity).not.toHaveBeenCalled();
  });

  it("fails closed when structured preflight declines", async () => {
    structured.mockResolvedValue({ matched: false });
    const result = await handleCoffeeSugarRegistrationIntent({ userId: 1, text: "3 xicaras de cafe", receivedAt, userTimezone: "America/Sao_Paulo", messageId: "msg-2" });
    expect(result).toMatchObject({ action: "clarification_needed", data: { fallbackBlocked: true } });
    expect(confirmed).not.toHaveBeenCalled();
  });
});
