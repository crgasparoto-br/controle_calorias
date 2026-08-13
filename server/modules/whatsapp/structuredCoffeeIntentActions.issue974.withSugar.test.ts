import { describe, expect, it, vi } from "vitest";

const processMock = vi.hoisted(() => vi.fn());
const sugarMock = vi.hoisted(() => vi.fn());
const createMealMock = vi.hoisted(() => vi.fn());
vi.mock("./intentContext", () => ({ buildWhatsappIntentContext: vi.fn() }));
vi.mock("./intentInterpreter", () => ({ interpretWhatsappMessageWithDiagnostics: vi.fn() }));
vi.mock("./intentAuditLog", () => ({ recordWhatsappIntentAuditLog: vi.fn() }));
vi.mock("./intentValidation", () => ({ validateWhatsappRuntimeIntentForPersistence: vi.fn() }));
vi.mock("../meals/service", () => ({ listMeals: vi.fn(async () => []), createManualMeal: createMealMock, updateMeal: vi.fn() }));
vi.mock("../../db", () => ({ getDb: vi.fn(), getHabitSnapshots: vi.fn(async () => []), logPersistenceWarning: vi.fn() }));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({ createDrizzleWhatsAppPendingOperationRepository: vi.fn(() => ({ getActivePendingOperation: vi.fn() })) }));
vi.mock("../../nutritionEngine", () => {
  class MealInferenceError extends Error {
    code: string;
    context?: { component?: string };
    constructor(message: string, code: string, context?: { component?: string }) {
      super(message);
      this.code = code;
      this.context = context;
    }
  }
  return { MealInferenceError, processMealInput: processMock };
});
vi.mock("./foodQuantityClarification", () => ({ requestWhatsappCaloricComplementQuantityClarification: sugarMock }));
vi.mock("./mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: vi.fn() }));
vi.mock("./userMeasurementReplyContext", () => ({ getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo") }));

import { MealInferenceError } from "../../nutritionEngine";
import { resumeWhatsappStructuredCoffeePreparation } from "./structuredCoffeeIntentActions";

const receivedAt = new Date("2026-08-13T13:00:00.000Z");
const target = {
  contractVersion: 1 as const,
  interactionId: "coffee_preparation.sugar_choice" as const,
  kind: "coffee_preparation_clarification" as const,
  originalText: "3 xícaras de café e 1 pão no café da manhã",
  originalReceivedAt: receivedAt.toISOString(),
  inboundMessageId: "wamid-974-sugar",
  userTimezone: "America/Sao_Paulo",
  mealLabel: "Café da manhã",
  createIfMissing: true,
  intentDate: null,
  items: [
    { foodName: "Café", quantity: 3, unit: "xícaras", brand: null, preparation: null },
    { foodName: "Pão", quantity: 1, unit: "unidade", brand: null, preparation: null },
  ],
  ambiguousItemIndexes: [0],
  instructionText: "Seu café foi sem açúcar ou com açúcar?",
  actions: [],
};

describe("issue #974 - café com açúcar", () => {
  it("with_sugar preserva o contexto ao pedir a quantidade de açúcar", async () => {
    processMock.mockRejectedValue(new MealInferenceError("Quantidade necessária", "food_component_quantity_required", { component: "açúcar" }));
    sugarMock.mockResolvedValue({ handled: true, action: "food_clarification_requested", reply: "Informe a quantidade de açúcar.", eventType: "quantity_requested", detail: "pendente" });

    const result = await resumeWhatsappStructuredCoffeePreparation({ userId: 42, target, choice: "with_sugar", receivedAt });

    expect(result).toMatchObject({ action: "clarification_needed" });
    expect(sugarMock).toHaveBeenCalledWith(expect.objectContaining({
      originalText: target.originalText,
      originalFoodText: expect.stringContaining("Pão"),
      messageId: "wamid-974-sugar",
      operation: expect.objectContaining({ kind: "register" }),
    }));
    expect(sugarMock.mock.calls[0][0].originalFoodText).toContain("Café da manhã");
    expect(createMealMock).not.toHaveBeenCalled();
  });
});
