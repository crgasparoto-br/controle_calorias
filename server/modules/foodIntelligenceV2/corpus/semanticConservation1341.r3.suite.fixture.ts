import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFoodObservationFixture } from "../fixtures";
import {
  comprehendFoodMaterialLanguage,
  type LinguisticLexiconStore,
} from "../linguisticComprehension";
import {
  parseFoodMaterialObservationBatch,
  type FoodMaterialObservation,
} from "../schemas";
import { GOLDEN_CORPUS_VERSION } from "./contracts";
import {
  c1bCases,
  type C1bCase,
} from "./semanticConservation1341.test.fixture";
import { factSourceRange } from "./semanticConservation1341.test.support.fixture";
import { compareC1bR3 } from "./semanticConservation1341.r3.test.support";

/** Wire fixtures from authored offsets/labels only, not producer outputs. */
function r3ControlObservation(
  testCase: C1bCase,
  fact: C1bCase["facts"][number],
  index: number
): FoodMaterialObservation {
  if (
    fact.kind !== "ingredient-quantity" ||
    fact.owner === null ||
    fact.ingredient === null ||
    fact.quantity === null ||
    fact.unit === null
  )
    throw new Error("unexpected R3 control fact");
  const ownerId = "synthetic-owner-" + index;
  const ingredientId = ownerId + ":ingredient";
  const amountId = ownerId + ":amount";
  const base = buildFoodObservationFixture();
  const start = fact.scopeStart ?? testCase.text.indexOf(fact.scope);
  const [amountStart, end] = factSourceRange(testCase, fact);
  const ingredientStart = end - fact.ingredient.length;
  const ownerStart = testCase.text.indexOf(fact.owner, start);
  const measureEnd = fact.surface.lastIndexOf(" de ");
  if (measureEnd < 1)
    throw new Error("control needs an explicit ingredient separator");
  const anchor = (a: number, b: number) => ({
    sourceRef: "c1b:" + testCase.id,
    region: null,
    span: { start: a, end: b },
  });
  const origin = testCase.modality === "text" ? "text" : "transcription";
  return {
    ...base,
    modality: testCase.modality,
    schemaVersion: 3,
    observationId: ownerId,
    rawInput: testCase.text,
    normalizedInput: null,
    surfaceSpan: anchor(start, start + fact.scope.length),
    identityHints: { ...base.identityHints, foodName: fact.owner },
    quantityHints: {
      value: null,
      unit: null,
      servingText: null,
      visiblePackageQuantity: null,
      visiblePackageUnit: null,
    },
    normalizationPath: [],
    alternatives: [],
    unresolvedReason: null,
    interpreterVersion: null,
    evidence: [
      {
        evidenceId: ownerId + ":name",
        field: "identity.foodName",
        value: fact.owner,
        unit: null,
        anchor: anchor(ownerStart, ownerStart + fact.owner.length),
        origin,
        confidence: null,
        verified: false,
        sourceId: null,
      },
      {
        evidenceId: ingredientId,
        field: "material.ingredient",
        value: fact.ingredient,
        unit: null,
        anchor: anchor(ingredientStart, end),
        origin,
        confidence: null,
        verified: false,
        sourceId: null,
      },
      {
        evidenceId: amountId,
        field: "material.amount",
        value: fact.quantity,
        unit: fact.unit,
        ingredientEvidenceId: ingredientId,
        anchor: anchor(amountStart, amountStart + measureEnd),
        origin,
        confidence: null,
        verified: false,
        sourceId: null,
      },
    ],
    materialClaims: [
      {
        kind: "ingredient",
        claimId: ownerId + ":claim",
        binding: { status: "bound", ownerObservationId: ownerId },
        ingredient: { name: fact.ingredient, evidenceId: ingredientId },
        amount: { value: fact.quantity, unit: fact.unit, evidenceId: amountId },
      },
    ],
  };
}

export function registerC1bR3DiagnosticSuite(
  cases: readonly C1bCase[],
  generatorVersion: string
) {
  const emptyGovernedLexicon: LinguisticLexiconStore = { load: async () => [] };
  describe("#1341 R3: comparação diagnóstica da regressão congelada", () => {
    it("prova vínculo sintético e refuta omissão e troca de medidas apesar de schema R3 válido", () => {
      const testCase = cases.find(item => item.id === "sugar-gram-other-food")!;
      const correct = testCase.facts.map((fact, i) =>
        r3ControlObservation(testCase, fact, i)
      );
      const matched = compareC1bR3(testCase, {
        ok: true,
        observations: correct,
      });
      expect(matched.findings.map(row => row.status)).toEqual([
        "verified",
        "verified",
      ]);
      expect(matched).toMatchObject({
        diagnosticBatchComplete: true,
        authority: "diagnostic-only",
        issues: [],
      });

      const omitted = compareC1bR3(testCase, {
        ok: true,
        observations: [correct[0]],
      });
      expect(omitted.findings.map(row => row.status)).toEqual([
        "verified",
        "missing",
      ]);
      expect(omitted.diagnosticBatchComplete).toBe(false);

      const swapped = structuredClone(correct);
      for (const [index, observation] of swapped.entries()) {
        const claim = observation.materialClaims[0];
        if (claim.kind !== "ingredient" || !claim.amount)
          throw new Error("control lacked ingredient amount");
        const other = testCase.facts[1 - index];
        claim.amount.value = other.quantity!;
        claim.amount.unit = other.unit!;
        const ev = observation.evidence.find(
          item => item.evidenceId === claim.amount!.evidenceId
        )!;
        ev.value = other.quantity;
        ev.unit = other.unit;
      }
      expect(parseFoodMaterialObservationBatch(swapped).ok).toBe(true);
      const mismatch = compareC1bR3(testCase, {
        ok: true,
        observations: swapped,
      });
      expect(mismatch.findings.map(row => row.status)).toEqual([
        "semantic-mismatch",
        "semantic-mismatch",
      ]);
      expect(mismatch.issues).toContain("unexpected-or-mismatched-typed-claim");
      expect(mismatch.diagnosticBatchComplete).toBe(false);

      const shortened = structuredClone(correct);
      const amount = shortened[0].evidence.find(
        item => item.field === "material.amount"
      )!;
      amount.anchor.span!.end = amount.anchor.span!.start + 1;
      expect(parseFoodMaterialObservationBatch(shortened).ok).toBe(true);
      expect(
        compareC1bR3(testCase, { ok: true, observations: shortened })
      ).toMatchObject({
        diagnosticBatchComplete: false,
        findings: [{ status: "semantic-mismatch" }, { status: "verified" }],
      });

      const contradictory = structuredClone(correct);
      const identity = contradictory[0].evidence.find(
        item => item.field === "identity.foodName"
      )!;
      contradictory[0].evidence.push({
        ...identity,
        evidenceId: identity.evidenceId + ":contradiction",
        value: testCase.facts[1].owner,
      });
      expect(parseFoodMaterialObservationBatch(contradictory).ok).toBe(true);
      expect(
        compareC1bR3(testCase, { ok: true, observations: contradictory })
      ).toMatchObject({
        diagnosticBatchComplete: false,
        findings: [{ status: "semantic-mismatch" }, { status: "verified" }],
      });

      const ownerless = structuredClone(correct);
      ownerless[0].surfaceSpan.span!.start = factSourceRange(
        testCase,
        testCase.facts[0]
      )[0];
      const lostOwnerEvidence = ownerless[0].evidence.find(
        item => item.field === "identity.foodName"
      )!;
      lostOwnerEvidence.anchor.span = {
        start: ownerless[0].surfaceSpan.span!.start,
        end: ownerless[0].surfaceSpan.span!.start + 1,
      };
      expect(parseFoodMaterialObservationBatch(ownerless).ok).toBe(true);
      expect(
        compareC1bR3(testCase, { ok: true, observations: ownerless })
      ).toMatchObject({
        diagnosticBatchComplete: false,
        findings: [{ status: "semantic-mismatch" }, { status: "verified" }],
      });
    });

    it("conserva irmãos provados, mas abstém somente com âncora e não admite lote parcial", () => {
      const testCase = cases.find(item => item.id === "sugar-extra-unbound")!;
      const observations = testCase.facts.flatMap((fact, i) =>
        fact.kind === "ingredient-quantity"
          ? [r3ControlObservation(testCase, fact, i)]
          : []
      );
      const pending = testCase.facts.find(item => item.kind === "unbound")!;
      const [start, end] = factSourceRange(testCase, pending);
      const suggestion = {
        ok: false as const,
        reason: "unproven-material" as const,
        observations,
        affected: [
          {
            observationId: "synthetic-pending",
            surfaceSpan: {
              sourceRef: "c1b:" + testCase.id,
              region: null,
              span: { start, end },
            },
          },
        ],
      };
      const result = compareC1bR3(testCase, suggestion);
      expect(result.findings.map(row => row.status)).toEqual([
        "verified",
        "verified",
        "abstained",
      ]);
      expect(result).toMatchObject({
        diagnosticBatchComplete: false,
        authority: "diagnostic-only",
        issues: [],
      });
      const wrongSource = structuredClone(suggestion);
      wrongSource.affected[0].surfaceSpan.sourceRef = "unrelated";
      const invalid = compareC1bR3(testCase, wrongSource);
      expect(invalid.findings[2].status).not.toBe("abstained");
      expect(invalid.issues).toContain("invalid-abstention-anchor-or-identity");
      expect(invalid.diagnosticBatchComplete).toBe(false);
    });

    it("mede o produtor R3 sem usar êxito de cobertura como condição de CI ou aprovação", async () => {
      // Exact authored+generated input (including every split, modality and label).
      // This is a known frozen regression, NOT a new blinded generalization sample.
      const caseSetSha256 = createHash("sha256")
        .update(JSON.stringify(cases))
        .digest("hex");
      expect(caseSetSha256).toBe(
        "6dc8284dc939d072c54152eae5c2c540b4c1d4b6f863f3eb28e6670b0a1c1675"
      );
      const rows = await Promise.all(
        cases.map(async testCase =>
          compareC1bR3(
            testCase,
            await comprehendFoodMaterialLanguage(
              {
                rawText: testCase.text,
                sourceRef: "c1b:" + testCase.id,
                modality: testCase.modality,
                ownerUserId: null,
                lexiconRevision: "c1b-empty-s2",
                now: new Date("2026-11-12T12:00:00.000Z"),
                ...(testCase.modality === "audio_transcript"
                  ? { transcriptionConfidence: 0.9 }
                  : {}),
              },
              emptyGovernedLexicon
            )
          )
        )
      );
      const aggregate = (subset: typeof rows) => {
        const counts = {
          verified: 0,
          abstained: 0,
          "semantic-mismatch": 0,
          missing: 0,
        };
        const proof = {
          "typed-ingredient": 0,
          "existing-observation-field": 0,
          "explicit-source-abstention": 0,
        };
        for (const fact of subset.flatMap(row => row.findings)) {
          counts[fact.status]++;
          if (fact.proof) proof[fact.proof]++;
        }
        return {
          cases: subset.length,
          facts: Object.values(counts).reduce((a, b) => a + b, 0),
          counts,
          proof,
          casesProducerAbstained: subset.filter(
            row => row.producer === "unproven-material"
          ).length,
          casesDiagnosticComplete: subset.filter(
            row => row.diagnosticBatchComplete
          ).length,
          issues: subset.reduce((total, row) => total + row.issues.length, 0),
        };
      };
      const byPartition = (subset: typeof rows) =>
        Object.fromEntries(
          ["calibration", "holdout"].map(split => [
            split,
            aggregate(subset.filter(row => row.split === split)),
          ])
        );
      const report = {
        schemaVersion: 1,
        wireRevision: 3,
        suiteVersion: "c1b-r3-compare-v1",
        reference: "frozen-c1b-regression",
        caseSetSha256,
        generatorVersion,
        corpusVersion: GOLDEN_CORPUS_VERSION,
        authority: "diagnostic-only",
        r2: "separately-reproducible-formal-c1b",
        producerSha: process.env.VERIFICATION_HEAD_SHA ?? "not-provided",
        totals: aggregate(rows),
        byPartition: byPartition(rows),
        bySuite: {
          authored: byPartition(rows.slice(0, c1bCases.length)),
          generated: byPartition(rows.slice(c1bCases.length)),
        },
        rows,
      };
      expect(report.totals.cases).toBe(cases.length);
      expect(report.totals.facts).toBe(
        cases.reduce((sum, item) => sum + item.facts.length, 0)
      );
      // Always a separate local diagnostic artifact; never overwrite formal R2.
      if (process.env.C1B_R3_DIAGNOSTIC_OUTPUT_DIR) {
        await mkdir(process.env.C1B_R3_DIAGNOSTIC_OUTPUT_DIR, {
          recursive: true,
        });
        await writeFile(
          join(
            process.env.C1B_R3_DIAGNOSTIC_OUTPUT_DIR,
            "c1b-1341-r3-diagnostic.json"
          ),
          JSON.stringify(report, null, 2) + "\n"
        );
      }
    });
  });
}
