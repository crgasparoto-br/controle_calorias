import { describe, expect, it } from "vitest";
import { isGroundedEvidenceOrigin } from "../contracts";
import { parseFoodResolutionDecision } from "../schemas";
import { goldenFoodCorpus } from "./data";
import { buildDecisionForExpected } from "./selfTestResolvers";

describe("A-1298-006: referencia sintetica non_food", () => {
  it("sustenta rejeicao com evidencia negativa e falha sem prova", () => {
    let nonFoodDecisions = 0;
    let otherDecisions = 0;

    for (const entry of goldenFoodCorpus.cases) {
      entry.expected.decisions.forEach((expected, index) => {
        const decision = buildDecisionForExpected(entry, expected, index);
        const negativeEvidence = decision.evidence.filter(
          evidence => evidence.field === "classification.isFood"
        );

        if (!expected.reasonCodes.includes("non_food")) {
          otherDecisions++;
          expect(negativeEvidence).toHaveLength(0);
          return;
        }

        nonFoodDecisions++;
        expect(decision.status).toBe("unknown");
        expect(decision.nextAction).toBe("reject");
        expect(negativeEvidence).toHaveLength(1);
        expect(negativeEvidence[0]).toMatchObject({
          value: false,
          unit: null,
          verified: true,
        });
        expect(isGroundedEvidenceOrigin(negativeEvidence[0].origin)).toBe(true);
        expect(parseFoodResolutionDecision(decision).ok).toBe(true);

        const withoutProof = structuredClone(decision);
        withoutProof.evidence = withoutProof.evidence.filter(
          evidence => evidence.field !== "classification.isFood"
        );
        expect(parseFoodResolutionDecision(withoutProof).ok).toBe(false);

        const unverified = structuredClone(decision);
        unverified.evidence.find(
          evidence => evidence.field === "classification.isFood"
        )!.verified = false;
        expect(parseFoodResolutionDecision(unverified).ok).toBe(false);

        const missingNegativeValue = structuredClone(decision);
        missingNegativeValue.evidence.find(
          evidence => evidence.field === "classification.isFood"
        )!.value = null;
        expect(parseFoodResolutionDecision(missingNegativeValue).ok).toBe(false);
      });
    }

    expect(nonFoodDecisions).toBeGreaterThan(0);
    expect(otherDecisions).toBeGreaterThan(0);
  });
});
