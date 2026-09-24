import { describe, expect, it } from "vitest";
import { resolveStructuredCommercialIdentity } from "./commercialFoodIdentityPreflight";

describe("issue #1181 — identidade natural antes da heurística comercial", () => {
  it.each(["pêra", "pêra packans", "pêra golden", "laranja pêra", "mamão formosa"])(
    "preserva qualificador natural não comprovado sem promovê-lo a marca: %s",
    foodName => {
      expect(resolveStructuredCommercialIdentity({
        segment: `1 ${foodName}`,
        foodName,
        brand: null,
      })).toEqual({ brand: null });
    },
  );

  it("mantém a identidade comercial explícita em fail-closed", () => {
    expect(resolveStructuredCommercialIdentity({
      segment: "15 g de manteiga Batavo",
      foodName: "manteiga Batavo",
      brand: null,
    })).toEqual({ brand: "Batavo" });
  });

  it("não transforma produto industrializado sem marca comprovada em alimento natural", () => {
    expect(resolveStructuredCommercialIdentity({
      segment: "1 refrigerante laranja",
      foodName: "refrigerante laranja",
      brand: null,
    })).toMatchObject({
      brand: null,
      identityClarification: {
        context: { clarificationReason: "commercial_identity_unverified" },
      },
    });
  });
});
