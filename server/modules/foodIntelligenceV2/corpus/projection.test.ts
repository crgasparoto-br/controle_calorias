import { describe, expect, it } from "vitest";
import { buildFoodResolutionDecisionFixture } from "../fixtures";
import {
  decisionsSemanticallyEqual,
  isCurrentDecisionSchemaVersion,
  projectDecision,
} from "./projection";

describe("projeção semântica (§4.1.8)", () => {
  it("exclui identificadores de execução, texto cru e confiança da igualdade literal", () => {
    const base = buildFoodResolutionDecisionFixture();
    const variant = buildFoodResolutionDecisionFixture({
      decisionId: "dec-outro",
      traceId: "trace-outro",
      observationIds: ["obs-outro"],
      revision: 7,
      knowledgeRevision: "kn-outra",
      policyVersion: "pol-outra",
    });

    const projected = projectDecision(base);
    const otherProjected = projectDecision(variant);

    expect(JSON.stringify(projected)).not.toContain("dec-1");
    expect(JSON.stringify(projected)).not.toContain("trace-1");
    expect(JSON.stringify(projected)).not.toContain("mortadela");
    expect(decisionsSemanticallyEqual(projected, otherProjected)).toBe(true);
  });

  it("preserva identidade, qualificadores, quantidade e multiplicidade", () => {
    const projected = projectDecision(buildFoodResolutionDecisionFixture());
    expect(projected.identity.canonicalName).toBe("Mortadela");
    expect(projected.quantity.value).toBe(1.5);
    expect(projected.quantity.unit).toBe("fatia");
    expect(projected.quantity.measureKind).toBe("usual_average");
    expect(projected.nutrition.origins).toStrictEqual(["nutrition_label"]);
    expect(projected.nutrition.verifiedBySpecificEvidence).toBe(true);
  });

  it("distingue decisões materialmente diferentes", () => {
    const base = projectDecision(buildFoodResolutionDecisionFixture());
    const altered = projectDecision(
      buildFoodResolutionDecisionFixture({
        identity: {
          candidateKey: "cand-mortadela",
          foodEntityId: 42,
          variantId: null,
          canonicalName: "Mortadela",
          brand: "Sadia",
          variant: null,
          preparation: [],
          qualifiers: [],
          barcode: null,
          confidence: 0.9,
          evidenceIds: ["ev-ident"],
        },
      })
    );
    expect(decisionsSemanticallyEqual(base, altered)).toBe(false);
  });

  it("reconhece a versão corrente do contrato de decisão", () => {
    expect(
      isCurrentDecisionSchemaVersion(buildFoodResolutionDecisionFixture())
    ).toBe(true);
  });

  it("detecta unidade de massa usada como se fosse porção", () => {
    const projected = projectDecision(
      buildFoodResolutionDecisionFixture({
        quantity: {
          value: 30,
          unit: "g",
          grams: 30,
          milliliters: null,
          portionId: null,
          source: null,
          measureKind: "exact",
          confidence: 0.8,
          evidenceIds: [],
        },
      })
    );
    expect(projected.quantity.unitIsMass).toBe(true);
  });
});
