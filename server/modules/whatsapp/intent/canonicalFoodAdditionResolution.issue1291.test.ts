import { describe, expect, it, vi } from "vitest";
import { MealInferenceError, processMealInput } from "../../../nutritionEngine";
import {
  resolveCanonicalFoodAdditionItems,
  type CanonicalFoodAdditionResolution,
} from "./canonicalFoodAdditionResolution";
import { resolveCommercialFoodIdentity, resolveHouseholdMeasure } from "../../../nutritionEngine";
import { resolveHouseholdMeasure as resolveHouseholdMeasureReal } from "../../../householdMeasureResolution";

const occurredAt = new Date("2026-10-02T01:01:00.000Z");
const timeZone = "America/Sao_Paulo";

function additionWithMortadela() {
  return {
    mealLabel: "café da manhã",
    date: occurredAt,
    items: [{ foodName: "mortadela", quantity: 1.5, unit: "fatia", brand: null }],
  };
}

describe("resolveCanonicalFoodAdditionItems — fallback canônico medido (#1291)", () => {
  it("materializa a fatia de mortadela pelo catálogo quando o motor nutricional está indisponível", async () => {
    const runtime = {
      processMealInput: vi.fn(async () => {
        throw new MealInferenceError(undefined, { code: "meal_inference_unavailable" });
      }),
      resolveCommercialFoodIdentity,
      resolveHouseholdMeasure,
    };

    const resolution: CanonicalFoodAdditionResolution = await resolveCanonicalFoodAdditionItems(
      { userId: 7, addition: additionWithMortadela() as never, occurredAt, timeZone },
      runtime,
    );

    expect(resolution.kind).toBe("items");
    if (resolution.kind !== "items") return;
    expect(runtime.processMealInput).toHaveBeenCalled();
    expect(resolution.items[0]).toMatchObject({
      foodName: "mortadela",
      quantity: 1.5,
      unit: "fatia",
      estimatedGrams: 22.5,
      calories: 60.5,
      source: "catalog",
    });
  });

  it("continua propagando clarificação de identidade comercial", async () => {
    const runtime = {
      processMealInput: vi.fn(async () => {
        throw new MealInferenceError("Não consegui comprovar a identidade comercial exata de Cerveja Original.", {
          code: "food_identity_clarification_required",
        });
      }),
      resolveCommercialFoodIdentity,
      resolveHouseholdMeasure,
    };

    await expect(
      resolveCanonicalFoodAdditionItems(
        {
          userId: 7,
          addition: {
            mealLabel: "almoço",
            date: occurredAt,
            items: [{ foodName: "cerveja original", quantity: 600, unit: "ml", brand: null }],
          } as never,
          occurredAt,
          timeZone,
        },
        runtime,
      ),
    ).rejects.toBeInstanceOf(MealInferenceError);
  });

  it("usa o caminho canônico local quando o motor responde normalmente", async () => {
    const runtime = {
      processMealInput,
      resolveCommercialFoodIdentity,
      resolveHouseholdMeasure: resolveHouseholdMeasureReal,
    };

    const resolution = await resolveCanonicalFoodAdditionItems(
      { userId: 7, addition: additionWithMortadela() as never, occurredAt, timeZone },
      runtime,
    );

    expect(resolution.kind).toBe("items");
    if (resolution.kind !== "items") return;
    expect(resolution.items[0].estimatedGrams).toBe(22.5);
  });
});