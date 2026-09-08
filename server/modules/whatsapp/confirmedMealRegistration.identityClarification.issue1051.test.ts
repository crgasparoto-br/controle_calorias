import { describe, expect, it, vi } from "vitest";
import { MealInferenceError } from "../../nutritionEngine";
import { createConfirmedMealRegistrationService } from "./confirmedMealRegistration";

describe("issue #1051 — registro confirmado respeita ambiguidade comercial", () => {
  it("não inicia mutação quando o motor exige variante e preserva o contexto para continuação persistente", async () => {
    const createDraft = vi.fn();
    const confirmMeal = vi.fn();
    const semanticContract = {
      version: 1 as const,
      originalText: "2 fatias de pão de forma Panco",
      normalizedText: "2 fatias de pao de forma panco",
      inputType: "text" as const,
      intent: "add_foods_to_meal",
      items: [],
      needsClarification: true,
      clarifications: [{
        itemIndex: 0,
        code: "brand_variant_unresolved" as const,
        message: "Informe a variante do pão Panco.",
        alternatives: [],
      }],
    };
    const processMeal = vi.fn(async () => {
      throw new MealInferenceError("Informe a variante do pão Panco.", {
        code: "food_identity_clarification_required",
        context: {
          originalText: "2 fatias de pão de forma Panco",
          foodName: "Pão de Forma Panco",
          brand: "Panco",
          clarificationReason: "brand_variant_unresolved",
          alternatives: [],
          semanticContract,
        },
      });
    });

    const execute = createConfirmedMealRegistrationService({
      processMeal: processMeal as never,
      getHabits: vi.fn(async () => []),
      createDraft: createDraft as never,
      confirmMeal: confirmMeal as never,
      consolidateMeal: vi.fn() as never,
      getGoalProgress: vi.fn() as never,
      prepareCountableFoodRegistration: vi.fn(async input => ({
        kind: "ready" as const,
        registrationText: input.text,
      })) as never,
    });

    const outcome = await execute({
      userId: 7,
      registrationText: "2 fatias de pão de forma Panco",
      originalText: "2 fatias de pão de forma Panco",
      occurredAt: new Date("2026-09-06T09:00:00-03:00"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(outcome).toMatchObject({
      status: "details_needed",
      prompt: "Informe a variante do pão Panco.",
      context: {
        brand: "Panco",
        clarificationReason: "brand_variant_unresolved",
        semanticContract: {
          needsClarification: true,
        },
      },
    });
    expect(processMeal).toHaveBeenCalledOnce();
    expect(createDraft).not.toHaveBeenCalled();
    expect(confirmMeal).not.toHaveBeenCalled();
  });
});
