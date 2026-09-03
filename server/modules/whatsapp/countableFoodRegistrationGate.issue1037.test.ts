import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareResolved: vi.fn(),
  requestClarification: vi.fn(),
}));

vi.mock("../../countableFoodQuantity", () => ({
  prepareCountableFoodRegistrationResolved: mocks.prepareResolved,
}));
vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappConfirmedTextMealQuantityClarification: mocks.requestClarification,
}));

const { prepareWhatsappCountableFoodRegistration } = await import("./countableFoodRegistrationGate");

describe("countableFoodRegistrationGate issue #1037", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserva as resoluções junto com o registrationText no resultado ready", async () => {
    const resolutions = [{
      segmentIndex: 0,
      request: {
        segment: "2 fatias de mussarela",
        foodName: "mussarela",
        count: 2,
        requestedUnit: "fatia",
      },
      resolution: {
        kind: "usual_average" as const,
        grams: 41,
        requestedQuantity: 2,
        requestedUnit: "fatia",
        evidence: "média usual verificável",
        sourceUrls: ["https://example.com/a", "https://example.org/b"],
        referenceCount: 2,
      },
    }];
    mocks.prepareResolved.mockResolvedValue({
      registrationSegments: ["41 g de mussarela"],
      pendingItems: [],
      resolutions,
      registrationText: "41 g de mussarela",
    });

    const result = await prepareWhatsappCountableFoodRegistration({
      userId: 42,
      text: "2 fatias de mussarela",
    });

    expect(result).toEqual({
      kind: "ready",
      registrationText: "41 g de mussarela",
      resolutions,
    });
    expect(mocks.requestClarification).not.toHaveBeenCalled();
  });
});
