import { describe, expect, it, vi } from "vitest";
import type { CountableFoodResolvedMeasure } from "../../countableFoodQuantity";

const mocks = vi.hoisted(() => ({
  prepareResolved: vi.fn(),
}));

vi.mock("../../countableFoodQuantity", () => ({
  prepareCountableFoodRegistrationResolved: mocks.prepareResolved,
}));

const { prepareWhatsappCountableFoodRegistration } = await import(
  "./countableFoodRegistrationGate"
);

function resolvedMeasure(
  segmentIndex: number,
  segment: string,
  foodName: string,
  grams: number,
): CountableFoodResolvedMeasure {
  return {
    segmentIndex,
    request: {
      segment,
      foodName,
      brand: null,
      count: 1,
      requestedUnit: "un",
    },
    resolution: {
      kind: "canonical_portion",
      grams,
    },
  };
}

describe("countableFoodRegistrationGate issue #1256", () => {
  it("materializa as referências locais reais antes de reprocessar o texto reescrito", async () => {
    const inputs = [
      ["1 tapioca", "tapioca", 50],
      ["1 ovo frito", "ovo frito", 50],
      ["1 requeijão", "requeijão", 66],
      ["1 melão", "melão", 278],
      ["1 banana", "banana", 80],
    ] as const;
    const resolutions = inputs.map(([segment, foodName, grams], segmentIndex) =>
      resolvedMeasure(segmentIndex, segment, foodName, grams),
    );
    const registrationText = inputs
      .map(([, foodName, grams]) => `${grams} g de ${foodName}`)
      .join("\n");
    mocks.prepareResolved.mockResolvedValue({
      registrationSegments: inputs.map(([segment]) => segment),
      pendingItems: [],
      resolutions,
      registrationText,
    });

    const result = await prepareWhatsappCountableFoodRegistration({
      userId: 42,
      text: inputs.map(([segment]) => segment).join(", "),
      receivedAt: new Date("2026-09-30T12:00:00.000Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;

    const processedItems = result.resolvedSegments?.flatMap(
      segment => segment.processed.items,
    ) ?? [];
    expect(processedItems).toHaveLength(inputs.length);
    expect(processedItems.every(item => item.source === "catalog")).toBe(true);
    expect(processedItems.every(item => item.resolution?.nutritionOrigin === "catalog")).toBe(true);
    expect(processedItems.every(item => item.calories / (item.estimatedGrams / 100) !== 150)).toBe(true);
    expect(processedItems.find(item => item.foodName === "Ovo Frito")).toMatchObject({
      estimatedGrams: 50,
      calories: 120.1,
      protein: 7.8,
      carbs: 0.6,
      fat: 9.3,
    });
  });
});
