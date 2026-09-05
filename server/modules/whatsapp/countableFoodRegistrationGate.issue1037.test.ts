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
  it("preserva segmentos já resolvidos quando apenas outro item precisa de esclarecimento", async () => {
    mocks.prepareResolved.mockResolvedValue({
      registrationSegments: ["80 g de banana nanica", "2 ovos cozidos"],
      pendingItems: [{
        segmentIndex: 1,
        segment: "2 ovos cozidos",
        foodName: "ovos cozidos",
        count: 2,
        requestedUnit: "un",
      }],
      resolutions: [{
        segmentIndex: 0,
        request: {
          segment: "1 banana nanica",
          foodName: "banana nanica",
          count: 1,
          requestedUnit: "un",
        },
        resolution: { kind: "canonical_portion" as const, grams: 80 },
      }],
      registrationText: "80 g de banana nanica\n2 ovos cozidos",
    });
    mocks.requestClarification.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "Informe o peso de ovos cozidos.",
      eventType: "whatsapp.food_clarification.requested",
      detail: "Quantidade pendente.",
    });

    const result = await prepareWhatsappCountableFoodRegistration({
      userId: 42,
      text: "1 banana nanica, 2 ovos cozidos",
      originalText: "1 banana nanica, 2 ovos cozidos",
    });

    expect(result.kind).toBe("clarification");
    expect(mocks.requestClarification).toHaveBeenCalledWith(expect.objectContaining({
      foodName: "ovos cozidos",
      registrationSegments: ["80 g de banana nanica", "2 ovos cozidos"],
      pendingItems: [expect.objectContaining({
        segmentIndex: 1,
        foodName: "ovos cozidos",
      })],
      currentPendingIndex: 0,
    }));
  });

});
