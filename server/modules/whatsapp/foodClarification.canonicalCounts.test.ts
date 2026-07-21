import { describe, expect, it } from "vitest";
import {
  buildFoodClarificationRegistrationText,
  hasSafeCanonicalPortion,
  parseCountedFoodRequest,
  resolveFoodClarificationCandidates,
  type PendingFoodClarificationTarget,
} from "./foodClarificationContract";

function target(text: string): PendingFoodClarificationTarget {
  const request = parseCountedFoodRequest(text);
  if (!request) throw new Error(`Entrada não reconhecida: ${text}`);
  return {
    contractVersion: 1,
    interactionId: "canonical-count",
    kind: "food_registration_clarification",
    classification: "closed",
    pendingKind: "confirmation",
    originalText: request.originalText,
    sanitizedOriginalText: request.originalText,
    originalCandidate: request.originalCandidate,
    normalizedCandidate: request.normalizedCandidate,
    normalizationChanged: request.normalizationChanged,
    count: request.count,
    qualifiers: [],
    candidates: [],
    selectedCandidateIndex: 0,
    actions: [],
    instructionText: "",
    inboundMessageId: null,
    allowedDomainEffect: "register_original_food_once",
  };
}

describe("contagens com porção canônica da issue #855", () => {
  it.each([
    ["2 bananas", "Banana", /^2 unidade(?:s)? de Banana$/],
    ["3 ovos cozidos", "Ovo de galinha", /^3 unidade(?:s)? de Ovo de galinha$/],
  ])("resolve flexão em %s como candidato exato contável", (text, expectedName, expectedRegistration) => {
    const request = parseCountedFoodRequest(text);
    expect(request).not.toBeNull();
    const candidates = resolveFoodClarificationCandidates(request!.normalizedCandidate);
    const safe = candidates.find(hasSafeCanonicalPortion);

    expect(safe).toEqual(expect.objectContaining({
      name: expectedName,
      servingLabel: "1 unidade",
      matchKind: "exact",
    }));
    expect(buildFoodClarificationRegistrationText(target(text), safe!)).toMatch(expectedRegistration);
  });

  it("aceita iogurte exato de marca com embalagem fixa", () => {
    const candidates = resolveFoodClarificationCandidates("iogurte natural nestlé");
    expect(candidates.find(hasSafeCanonicalPortion)).toEqual(expect.objectContaining({
      name: "Iogurte natural Nestlé",
      servingLabel: "170 g",
      matchKind: "exact",
    }));
  });

  it("não transforma iogurte genérico em embalagem de produto semelhante", () => {
    const candidates = resolveFoodClarificationCandidates("iogurte natural desnatado");
    expect(candidates.filter(hasSafeCanonicalPortion)).toEqual([]);
  });
});
