import { describe, expect, it, vi } from "vitest";
import { persistResolvedCaloricComplement } from "./foodCaloricComplementPersistence";
import type { CaloricComplementQuantityContext } from "./foodQuantityClarification";

describe("falha de persistência entre cafés adoçados", () => {
  it("não envia a próxima pergunta nem altera refeição quando a nova pendência falha", async () => {
    const createMeal = vi.fn();
    const updateMeal = vi.fn();
    const createPendingOperation = vi.fn(async () => null);
    const context: CaloricComplementQuantityContext = {
      mode: "complete_caloric_complement",
      componentName: "açúcar",
      originalFoodText:
        "1 xícara de café com açúcar e 1 xícara de café adoçado",
      originalText:
        "1 xícara de café com açúcar e 1 xícara de café adoçado",
      inboundMessageId: "wamid-persistence-failure-903",
      completedComponents: [],
      coffeeQuantity: {
        quantity: 1,
        unit: "xícara",
        estimatedMl: 200,
        cupsEquivalent: 1,
      },
      operation: {
        kind: "register",
        occurredAt: "2026-07-24T10:00:00.000Z",
      },
    };

    const result = await persistResolvedCaloricComplement(
      {
        repository: { createPendingOperation } as any,
        processFood: vi.fn(async () => {
          throw {
            code: "food_component_quantity_required",
            context: { component: "açúcar" },
          };
        }),
        getHabits: vi.fn(async () => []),
        createMeal,
        listMeals: vi.fn(async () => []),
        updateMeal,
        removeMeal: vi.fn(async () => true),
      } as any,
      7,
      context,
      { quantity: 5, unit: "g" },
      new Date("2026-07-24T10:01:00.000Z"),
      "America/Sao_Paulo",
    );

    expect(result.action).toBe("food_clarification_blocked");
    expect(result.eventType).toBe("whatsapp.food_clarification.persistence_unavailable");
    expect(result.reply).not.toContain("Informe somente a quantidade");
    expect(createPendingOperation).toHaveBeenCalledTimes(1);
    expect(createMeal).not.toHaveBeenCalled();
    expect(updateMeal).not.toHaveBeenCalled();
  });
});
