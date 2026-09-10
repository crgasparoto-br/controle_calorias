import { beforeEach, describe, expect, it, vi } from "vitest";

const confirmed = vi.fn();
const quantity = vi.fn();
const structured = vi.fn();
const resolvePreference = vi.fn();
const logInferenceEvent = vi.fn(async () => undefined);

vi.mock("../../db", () => ({ logInferenceEvent }));
vi.mock("./confirmedMealRegistration", () => ({ executeConfirmedWhatsAppMealRegistration: confirmed }));
vi.mock("./foodQuantityClarification", () => ({ requestWhatsappCaloricComplementQuantityClarification: quantity }));
vi.mock("./structuredCoffeeIntentActions", () => ({ tryExecuteWhatsappStructuredCoffeeIntent: structured }));
vi.mock("./personalPreparationPreference", () => ({
  resolveWhatsappPersonalPreparationPreference: resolvePreference,
  applyPersonalPreparationChoiceToFoodMention: ({ text, foodPattern, choice }: { text: string; foodPattern: RegExp; choice: "without_sugar" | "with_sugar" }) =>
    text.replace(foodPattern, match => `${match} ${choice === "without_sugar" ? "sem açúcar" : "com açúcar"}`),
}));

const { handleCoffeeSugarRegistrationIntent } = await import("./coffeeSugarIntent");
const receivedAt = new Date("2026-09-10T13:00:00.000Z");

function memory(id = 501) {
  return {
    status: "applied" as const,
    choice: "without_sugar" as const,
    memory: { id, key: "food-preparation:cafe" },
  };
}

function registeredResult() {
  return {
    status: "registered" as const,
    result: {
      handled: true as const,
      action: "meal_item_added" as const,
      reply: "registrado",
      eventType: "meal.registered",
      detail: "pipeline canônico",
      data: {},
    },
  };
}

describe("issue #1059 - personal coffee preparation memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmed.mockResolvedValue(registeredResult());
    structured.mockResolvedValue({
      matched: true,
      result: { handled: true, action: "clarification_needed", reply: "com ou sem açúcar?", eventType: "coffee.clarify", detail: "safe" },
    });
    resolvePreference.mockResolvedValue(memory());
  });

  it.each([
    ["4 xícaras de café", "4 xícaras de café sem açúcar"],
    ["2 xícaras de café", "2 xícaras de café sem açúcar"],
  ])("reuses the same semantic memory regardless of quantity: %s", async (text, expected) => {
    const result = await handleCoffeeSugarRegistrationIntent({
      userId: 42,
      text,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: `msg-${text}`,
    });

    expect(resolvePreference).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      subject: "café",
      intent: "add_foods_to_meal",
    }));
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({
      registrationText: expected,
      originalText: text,
    }));
    expect(structured).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      action: "meal_item_added",
      data: { contextMemoryApplied: true, contextMemoryId: 501, preparationChoice: "without_sugar" },
    });
  });

  it("preserves companion items while filling only the missing coffee preparation", async () => {
    const text = "4 xícaras de café e 1 pão";
    await handleCoffeeSugarRegistrationIntent({ userId: 42, text, receivedAt, userTimezone: "America/Sao_Paulo", messageId: "compound" });
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({
      registrationText: "4 xícaras de café sem açúcar e 1 pão",
      originalText: text,
    }));
  });

  it("keeps #974 when no personal preference exists", async () => {
    resolvePreference.mockResolvedValue({ status: "missing" });
    const result = await handleCoffeeSugarRegistrationIntent({ userId: 42, text: "4 xícaras de café", receivedAt, userTimezone: "America/Sao_Paulo", messageId: "missing" });
    expect(result.action).toBe("clarification_needed");
    expect(structured).toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();
  });

  it("does not choose arbitrarily when persisted personal memories conflict", async () => {
    resolvePreference.mockResolvedValue({ status: "conflict", memoryIds: [501, 502] });
    const result = await handleCoffeeSugarRegistrationIntent({ userId: 42, text: "4 xícaras de café", receivedAt, userTimezone: "America/Sao_Paulo", messageId: "conflict" });
    expect(result.action).toBe("clarification_needed");
    expect(structured).toHaveBeenCalled();
    expect(confirmed).not.toHaveBeenCalled();
    expect(logInferenceEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "whatsapp.context_memory.preparation_conflict" }));
  });

  it.each(["4 xícaras de café com açúcar", "4 xícaras de café com leite"])("explicit preparation wins over memory: %s", async text => {
    await handleCoffeeSugarRegistrationIntent({ userId: 42, text, receivedAt, userTimezone: "America/Sao_Paulo", messageId: "explicit" });
    expect(resolvePreference).not.toHaveBeenCalled();
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ registrationText: text, originalText: text }));
  });
});
