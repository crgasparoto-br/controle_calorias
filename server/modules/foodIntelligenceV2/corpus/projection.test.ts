import { describe, expect, it } from "vitest";
import { buildFoodResolutionDecisionFixture } from "../fixtures";
import type { ExpectedDecision } from "./contracts";
import {
  classifyMeasureKind,
  decisionsSemanticallyEqual,
  isCurrentDecisionSchemaVersion,
  materialAttributeKey,
  projectDecision,
  projectExpectedDecision,
  projectionMultisetEqual,
} from "./projection";

function expectedDecision(
  over: Partial<ExpectedDecision> = {}
): ExpectedDecision {
  return {
    label: "item",
    status: "resolved",
    nextAction: "propose",
    identity: {
      presence: "expected",
      canonicalName: "arroz",
      brand: null,
      variant: null,
      preparation: [],
      qualifiers: [],
      barcode: null,
    },
    quantity: {
      presence: "expected",
      value: 100,
      unit: "g",
      grams: 100,
      milliliters: null,
      measureKind: "usual_average",
      unitMustNotBeConvertedToGrams: false,
    },
    nutrition: {
      requirement: "provenance_declared",
      allowedOrigins: [],
      forbiddenOrigins: [],
      provisionalRequired: false,
      genericProfileMustNotBeVerified: false,
    },
    ambiguity: { mustPreserveAlternatives: false, minAlternatives: 0 },
    alternatives: [],
    clarification: { requiredFields: [] },
    unresolvedFields: [],
    reasonCodes: [],
    forbiddenReasonCodes: [],
    ...over,
  };
}

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

  it("projeta a expectativa no mesmo espaço da decisão observada", () => {
    const projected = projectExpectedDecision(expectedDecision());
    expect(projected.status).toBe("resolved");
    expect(projected.identity.canonicalName).toBe("arroz");
    expect(projected.identity.sustained).toBe(true);
    expect(projected.quantity.value).toBe(100);
    expect(projected.quantity.unitIsMass).toBe(true);
  });

  it("normaliza campo proibido ou não afirmado para ausência na projeção", () => {
    const forbidden = projectExpectedDecision(
      expectedDecision({
        status: "ambiguous",
        nextAction: "clarify",
        identity: {
          presence: "forbidden",
          canonicalName: null,
          brand: null,
          variant: null,
          preparation: [],
          qualifiers: [],
          barcode: null,
        },
        quantity: {
          presence: "forbidden",
          value: null,
          unit: null,
          grams: null,
          milliliters: null,
          measureKind: null,
          unitMustNotBeConvertedToGrams: false,
        },
        nutrition: {
          requirement: "absent",
          allowedOrigins: [],
          forbiddenOrigins: [],
          provisionalRequired: false,
          genericProfileMustNotBeVerified: false,
        },
      })
    );
    expect(forbidden.identity.canonicalName).toBeNull();
    expect(forbidden.identity.sustained).toBe(false);
    expect(forbidden.quantity.value).toBeNull();
    expect(forbidden.nutrition.present).toBe(false);
  });

  it("compara decisões como multiconjunto determinístico", () => {
    const a = projectExpectedDecision(expectedDecision({ label: "a" }));
    const b = projectExpectedDecision(expectedDecision({ label: "b" }));
    const different = projectExpectedDecision(
      expectedDecision({
        quantity: {
          presence: "expected",
          value: 50,
          unit: "g",
          grams: 50,
          milliliters: null,
          measureKind: "usual_average",
          unitMustNotBeConvertedToGrams: false,
        },
      })
    );
    expect(projectionMultisetEqual([a], [b])).toBe(true);
    expect(projectionMultisetEqual([a], [different])).toBe(false);
    expect(projectionMultisetEqual([a], [a, b])).toBe(false);
    expect(projectionMultisetEqual([], [a])).toBe(false);
  });

  it("classifica a medida usada na segmentação de §16.2", () => {
    expect(classifyMeasureKind(null)).toBe("none");
    expect(classifyMeasureKind("g")).toBe("mass");
    expect(classifyMeasureKind("ml")).toBe("volume");
    expect(classifyMeasureKind("fatia")).toBe("count");
    expect(classifyMeasureKind("colher de sopa")).toBe("household");
    expect(classifyMeasureKind("jarda")).toBe("other");
  });

  it("extrai a chave material de variante, preparo e qualificadores", () => {
    const projected = projectExpectedDecision(
      expectedDecision({
        identity: {
          presence: "expected",
          canonicalName: "café",
          brand: null,
          variant: "arábica",
          preparation: ["coado"],
          qualifiers: ["sem açúcar"],
          barcode: null,
        },
      })
    );
    expect(materialAttributeKey(projected.identity)).toBe(
      "arábica+coado+sem açúcar"
    );
    expect(
      materialAttributeKey(projectExpectedDecision(expectedDecision()).identity)
    ).toBe("none");
  });
});
