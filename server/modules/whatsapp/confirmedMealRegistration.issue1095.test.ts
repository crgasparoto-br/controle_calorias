import { describe, expect, it, vi } from "vitest";
import type { MealProcessingResult } from "../../nutritionEngineTypes";
import { createConfirmedMealRegistrationService } from "./confirmedMealRegistration";

function processed(text: string, item: MealProcessingResult["items"][number]): MealProcessingResult {
  return {
    detectedMealLabel: "Café da manhã",
    sourceText: text,
    confidence: 0.95,
    needsConfirmation: false,
    reasoning: "fixture",
    items: [item],
    totals: {
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    },
    semanticContract: {
      version: 1,
      originalText: text,
      normalizedText: text.toLowerCase(),
      inputType: "text",
      intent: "add_foods_to_meal",
      items: [],
      needsClarification: false,
      clarifications: [],
    },
  };
}

function item(input: {
  foodName: string;
  brand?: string | null;
  grams: number;
  calories: number;
  resolution?: MealProcessingResult["items"][number]["resolution"];
}): MealProcessingResult["items"][number] {
  return {
    foodName: input.foodName,
    canonicalName: input.foodName,
    brand: input.brand ?? null,
    quantity: input.grams,
    unit: "g",
    portionText: `${input.grams} g`,
    servings: Math.max(input.grams / 100, 0.25),
    estimatedGrams: input.grams,
    calories: input.calories,
    protein: 4,
    carbs: 12,
    fat: 2,
    confidence: 0.95,
    source: input.resolution ? "catalog" : "hybrid",
    resolution: input.resolution,
  };
}

describe("issue #1095 — contrato semântico agregado", () => {
  it("reconstrói o contrato final com todos os segmentos, sem perder proveniência comercial", async () => {
    const commercialText = "1 fatia de pão de forma Panco Premium";
    const genericText = "100 g de arroz branco";
    const commercial = processed(commercialText, item({
      foodName: "Pão de Forma Panco Premium",
      brand: "Panco",
      grams: 25,
      calories: 63.5,
      resolution: {
        productVariant: "premium",
        nutritionOrigin: "web_research",
        nutritionVerified: true,
        sourceUrls: ["https://example.test/panco"],
        sourceEvidence: "2 fatias correspondem a 50 g.",
        sourceVerifiedAt: new Date("2026-09-16T00:00:00.000Z"),
        sourceConfidence: 0.96,
        ambiguity: null,
        measureResolution: {
          kind: "researched_exact",
          grams: 25,
          requestedQuantity: 1,
          requestedUnit: "fatia",
          sourceUrls: ["https://measure.example/panco"],
          sourceEvidence: "1 fatia corresponde a 25 g.",
          referenceCount: 1,
          verified: true,
        },
      },
    }));
    const generic = processed(genericText, item({
      foodName: "Arroz Branco",
      grams: 100,
      calories: 130,
    }));
    const processMeal = vi.fn(async () => generic);
    let captured: MealProcessingResult | undefined;
    const service = createConfirmedMealRegistrationService({
      processMeal: processMeal as any,
      getHabits: vi.fn(async () => []),
      createDraft: vi.fn((_userId, _origin, result) => {
        captured = result;
        return { draftId: "draft-1095" };
      }) as any,
      confirmMeal: vi.fn(async (input: any) => ({
        id: 1095,
        userId: input.userId,
        mealLabel: input.mealLabel,
        occurredAt: input.occurredAt,
        items: input.items,
      })) as any,
      consolidateMeal: vi.fn(async (_deps: unknown, meal: any) => ({
        action: "created" as const,
        meal,
      })) as any,
      getGoalProgress: vi.fn(async () => undefined),
    });

    const result = await service({
      userId: 1095,
      registrationText: `${commercialText}\n${genericText}`,
      originalText: `${commercialText}, ${genericText}`,
      occurredAt: new Date("2026-09-16T10:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      skipCountablePreflight: true,
      resolvedSegments: [{ segmentIndex: 0, processed: commercial }],
    });

    expect(result.status).toBe("registered");
    expect(processMeal).toHaveBeenCalledTimes(1);
    expect(captured?.semanticContract).toMatchObject({
      originalText: `${commercialText}, ${genericText}`,
      needsClarification: false,
      items: [
        expect.objectContaining({
          brand: "Panco",
          productVariant: "premium",
          estimatedGrams: 25,
          evidence: expect.objectContaining({
            nutrition: expect.objectContaining({
              origin: "web_research",
              verified: true,
              value: expect.objectContaining({
                calories: 63.5,
                protein: 4,
                carbs: 12,
                fat: 2,
                sourceUrls: ["https://example.test/panco"],
                sourceEvidence: "2 fatias correspondem a 50 g.",
                sourceVerifiedAt: "2026-09-16T00:00:00.000Z",
              }),
            }),
          }),
        }),
        expect.objectContaining({
          commercialName: "Arroz Branco",
          estimatedGrams: 100,
        }),
      ],
    });
    expect(captured?.semanticContract?.items).toHaveLength(2);
  });
});
