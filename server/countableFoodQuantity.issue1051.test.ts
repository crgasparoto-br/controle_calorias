import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveHouseholdMeasureMock = vi.hoisted(() => vi.fn());

vi.mock("./householdMeasureResolution", () => ({
  resolveHouseholdMeasure: resolveHouseholdMeasureMock,
}));

const { prepareCountableFoodRegistrationResolved } = await import(
  "./countableFoodQuantity"
);

describe("issue #1051 — identidade de marca no fluxo contável", () => {
  beforeEach(() => {
    resolveHouseholdMeasureMock.mockReset();
    resolveHouseholdMeasureMock.mockResolvedValue({
      kind: "researched_exact",
      grams: 50,
      requestedQuantity: 2,
      requestedUnit: "fatia",
      evidence: "50 g = 2 fatias",
      sourceUrls: ["https://example.com/panco-premium"],
      referenceCount: 1,
    });
  });

  it("propaga Panco ao resolvedor e preserva a identidade no texto reescrito", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "2 fatias de pão de forma Panco"
    );

    expect(resolveHouseholdMeasureMock).toHaveBeenCalledWith({
      userId: 42,
      foodName: "pão de forma Panco",
      brand: "Panco",
      quantity: 2,
      unit: "fatia",
    });
    expect(prepared).toEqual(
      expect.objectContaining({
        pendingItems: [],
        registrationText: "50 g de pão de forma Panco",
        resolutions: [
          expect.objectContaining({
            request: expect.objectContaining({ brand: "Panco" }),
          }),
        ],
      })
    );
  });
});
