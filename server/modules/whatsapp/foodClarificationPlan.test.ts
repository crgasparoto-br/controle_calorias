import { describe, expect, it } from "vitest";
import { planFoodClarification } from "./foodClarificationPlan";
import type { CountedFoodRequest, FoodClarificationCandidate } from "./foodClarificationContract";

const request: CountedFoodRequest = {
  originalText: "1 iorgute natural",
  originalCandidate: "iorgute natural",
  normalizedCandidate: "iogurte natural",
  normalizationChanged: true,
  count: 1,
};

function candidate(name: string, servingLabel = "100 g"): FoodClarificationCandidate {
  return {
    name,
    servingLabel,
    gramsPerServing: 100,
    brandName: null,
    isBrandedProduct: false,
    matchKind: "exact",
  };
}

describe("planFoodClarification", () => {
  it("não escolhe silenciosamente entre múltiplos candidatos após correção ortográfica", () => {
    const candidates = [
      candidate("Iogurte natural integral"),
      candidate("Iogurte natural desnatado"),
    ];

    expect(planFoodClarification(request, candidates)).toEqual({
      kind: "selection",
      candidates,
    });
  });

  it("pede quantidade quando não há porção segura nem ambiguidade de candidato", () => {
    const candidates = [candidate("Iogurte natural desnatado")];
    expect(planFoodClarification(request, candidates)).toEqual({
      kind: "quantity",
      candidates,
    });
  });

  it("registra diretamente apenas candidato único com porção segura e sem correção", () => {
    const plainRequest = { ...request, normalizationChanged: false };
    const safe = {
      ...candidate("Banana", "1 unidade"),
      gramsPerServing: 86,
    };

    expect(planFoodClarification(plainRequest, [safe])).toEqual({
      kind: "register",
      candidate: safe,
    });
  });
});
