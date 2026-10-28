/**
 * #1306 C3 empirical campaign.
 *
 * This file is intentionally test-only. Candidate sets and the calibration /
 * holdout split are declared here before the first execution. It never calls
 * an AI provider and never promotes a threshold by itself.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getTacoCatalog } from "../../../tacoLookup";
import { comprehendFoodLanguage } from "../linguisticComprehension";
import { resolveFoodObservations } from "../resolver";
import type { FoodKnowledgeStore, GovernedFoodMatch } from "../knowledgeRead";
import { goldenFoodCorpus } from "./data";
import { CALIBRATION_PARAMETERS, C3_PRE_REGISTERED_PARAMETER_DEFINITIONS } from "./calibration.test.support";

const TACO_PRIMARY_SOURCE =
  "https://nepa.unicamp.br/wp-content/uploads/sites/27/2023/10/taco_4_edicao_ampliada_e_revisada.pdf";

function numericCandidateSet(parameter: "rounding:energy" | "rounding:macros"): readonly number[] {
  const values = C3_PRE_REGISTERED_PARAMETER_DEFINITIONS[parameter].candidates;
  if (!values.every(value => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("C3 rounding candidates must be finite numbers");
  }
  return values as readonly number[];
}

const ENERGY_CANDIDATES = numericCandidateSet("rounding:energy");
const MACRO_CANDIDATES = numericCandidateSet("rounding:macros");
const CORE_FIELDS = ["calories", "protein", "carbs", "fat"] as const;
// This v2 cohort is fixed before its first CI measurement (issue comment
// #6478971288); it supplements, never retunes, the original 2+2 campaign.
// Nutrition profiles/families are disjoint between calibration and holdout.
const ROUNDING_QUANTITY_SCENARIOS = [
  { grams: 30, kilograms: "0,03" },
  { grams: 125, kilograms: "0,125" },
  { grams: 750, kilograms: "0,75" },
] as const;
type RoundingQuantityScenario = (typeof ROUNDING_QUANTITY_SCENARIOS)[number];
const ROUNDING_COHORT = {
  calibration: [
    ["Mortadela", "mortadela"],
    ["Amendoim, grão, cru", "amendoim cru"],
    ["Arroz, integral, cozido", "arroz integral cozido"],
    ["Queijo, minas, frescal", "queijo minas frescal"],
    ["Banana, nanica, crua", "banana nanica crua"],
    ["Batata, doce, cozida", "batata doce cozida"],
    ["Pão, trigo, forma, integral", "pão integral"],
    ["Tomate, com semente, cru", "tomate cru"],
    ["Laranja, baía, suco", "suco de laranja"],
    ["Chocolate, ao leite", "chocolate ao leite"],
    ["Macarrão, instantâneo", "macarrão instantâneo"],
    ["Ovo, de galinha, inteiro, cozido/10minutos", "ovo cozido"],
  ],
  holdout: [
    ["Iogurte, natural", "iogurte natural"],
    ["Pêra, Williams, crua", "pêra Williams"],
    ["Feijão, carioca, cozido", "feijão carioca cozido"],
    ["Abacate, cru", "abacate cru"],
    ["Aveia, flocos, crua", "aveia crua"],
    ["Biscoito, doce, maisena", "biscoito maisena"],
    ["Leite, de cabra", "leite de cabra"],
    ["Mamão, Papaia, cru", "mamão papaia cru"],
    ["Alface, americana, crua", "alface americana"],
    ["Frango, asa, com pele, crua", "asa de frango crua"],
    ["Carne, bovina, acém, moído, cozido", "acém moído cozido"],
    ["Margarina, com óleo hidrogenado, sem sal (80% de lipídeos)", "margarina sem sal"],
  ],
} as const;
type CoreField = (typeof CORE_FIELDS)[number];
type CoreValues = Record<CoreField, number>;
type RoundingSample = Readonly<{ profile: string; deltas: CoreValues }>;
type RoundingCandidateMetric = Readonly<{
  candidate: number;
  cases: number;
  passed: number;
  failed: number;
  maxDelta: number;
  failuresByClass: Readonly<Record<string, number>>;
}>;

type TacoRow = ReturnType<typeof getTacoCatalog>[number];

function requireTacoRow(name: string): TacoRow {
  const row = getTacoCatalog().find(item => item.name === name);
  if (!row) throw new Error("C3 source profile missing: " + name);
  const core = [row.calories, row.protein, row.carbs, row.fat];
  if (core.some(value => !Number.isFinite(value)) || core.every(value => value === 0)) {
    throw new Error("C3 invalid or absent core nutrition source profile: " + name);
  }
  return row;
}

function campaignStore(row: TacoRow): FoodKnowledgeStore {
  const match: GovernedFoodMatch = {
    kind: "match",
    matchingEvidence: "exact_variant",
    foodId: 1306001,
    variantId: 1306002,
    profileId: 1306003,
    variantName: row.name,
    sourceId: 1306004,
    sourceVersion: "taco-4e-repository-snapshot",
    sourceReference: TACO_PRIMARY_SOURCE,
    governanceStatus: "verified",
    nutrition: {
      caloriesKcal: row.calories,
      proteinG: row.protein,
      carbG: row.carbs,
      fatG: row.fat,
      basisQuantity: 100,
      basisUnit: "g",
    },
    portions: [],
  };
  return {
    async readLocal() {
      return match;
    },
    async readPendingEvidence() {
      return null;
    },
    async stagePendingEvidence() {
      return false;
    },
  };
}

async function resolveCore(row: TacoRow, surface: string, expectedGrams: number): Promise<CoreValues> {
  const observations = await comprehendFoodLanguage(
    {
      rawText: surface,
      sourceRef: "c3:rounding-campaign",
      modality: "text",
      ownerUserId: 1306,
      lexiconRevision: "c3-rounding-preregistered-v1",
    },
    { async load() { return []; } },
  );
  const decisions = await resolveFoodObservations(
    observations,
    {
      traceId: "c3:rounding:" + row.slug + ":" + surface,
      userId: 1306,
      knowledgeRevision: "taco-4e-repository-snapshot",
      policyVersion: "c3-rounding-preregistered-v1",
      resolverVersion: "c2-1305",
    },
    campaignStore(row),
  );
  expect(decisions).toHaveLength(1);
  expect(decisions[0].quantity.grams).not.toBeNull();
  expect(decisions[0].quantity.grams!).toBeCloseTo(expectedGrams, 10);
  const consumed = decisions[0].nutrition.consumed;
  expect(consumed).not.toBeNull();
  if (!consumed) throw new Error("C3 nutrition sample missing");
  const source: CoreValues = {
    calories: row.calories, protein: row.protein, carbs: row.carbs, fat: row.fat,
  };
  for (const field of CORE_FIELDS) {
    expect(consumed[field]).not.toBeNull();
    expect(consumed[field]!).toBeCloseTo(source[field] * expectedGrams / 100, 8);
  }
  return {
    calories: consumed.calories!,
    protein: consumed.protein!,
    carbs: consumed.carbs!,
    fat: consumed.fat!,
  };
}

async function measureEquivalentPair(
  row: TacoRow, label: string, scenario: RoundingQuantityScenario,
) {
  const grams = await resolveCore(row, scenario.grams + " g de " + label, scenario.grams);
  const kilograms = await resolveCore(row, scenario.kilograms + " kg de " + label, scenario.grams);
  return Object.fromEntries(
    CORE_FIELDS.map(field => [field, Math.abs(grams[field] - kilograms[field])]),
  ) as CoreValues;
}

function maxByField(samples: readonly CoreValues[]): CoreValues {
  return Object.fromEntries(
    CORE_FIELDS.map(field => [field, Math.max(...samples.map(sample => sample[field]))]),
  ) as CoreValues;
}

function selectCandidate(field: CoreField, observed: number): number {
  const candidates = field === "calories" ? ENERGY_CANDIDATES : MACRO_CANDIDATES;
  const selected = candidates.find(value => value >= observed);
  if (selected === undefined) throw new Error("C3 no preregistered rounding candidate covers " + field);
  return selected;
}

function candidatesForField(field: CoreField): readonly number[] {
  return field === "calories" ? ENERGY_CANDIDATES : MACRO_CANDIDATES;
}

function evaluateRoundingCandidate(
  samples: readonly RoundingSample[], field: CoreField, candidate: number,
): RoundingCandidateMetric {
  const deltas = samples.map(sample => sample.deltas[field]);
  const failed = deltas.filter(delta => delta > candidate).length;
  const failureClass = "rounding_delta_exceeds_candidate:" + field;
  return {
    candidate,
    cases: deltas.length,
    passed: deltas.length - failed,
    failed,
    maxDelta: deltas.length ? Math.max(...deltas) : 0,
    failuresByClass: failed ? { [failureClass]: failed } : {},
  };
}

function comparisonToBaseline(
  samples: readonly RoundingSample[], field: CoreField, selected: number,
) {
  const baseline = evaluateRoundingCandidate(samples, field, 0);
  const candidate = evaluateRoundingCandidate(samples, field, selected);
  return {
    baselinePolicy: "open-fail-closed-zero-divergence",
    baseline,
    selected: candidate,
    passedDelta: candidate.passed - baseline.passed,
    failedDelta: candidate.failed - baseline.failed,
  };
}

function mergeFailureClasses(metrics: readonly RoundingCandidateMetric[]): Record<string, number> {
  const merged: Record<string, number> = {};
  for (const metric of metrics) {
    for (const [failureClass, count] of Object.entries(metric.failuresByClass)) {
      merged[failureClass] = (merged[failureClass] ?? 0) + count;
    }
  }
  return merged;
}

describe("#1306 C3 empirical evidence campaign", () => {
  it("selects rounding candidates only from calibration and validates them on reserved profiles", async () => {
    const calibrationProfiles = ROUNDING_COHORT.calibration.map(([name, label]) =>
      [requireTacoRow(name), label] as const);
    const calibration: RoundingSample[] = [];
    for (const [row, label] of calibrationProfiles) {
      for (const scenario of ROUNDING_QUANTITY_SCENARIOS) {
        calibration.push({
          profile: row.slug + "@" + scenario.grams + "g",
          deltas: await measureEquivalentPair(row, label, scenario),
        });
      }
    }
    const calibrationMax = maxByField(calibration.map(sample => sample.deltas));
    const selected = Object.fromEntries(
      CORE_FIELDS.map(field => [field, selectCandidate(field, calibrationMax[field])]),
    ) as CoreValues;

    // Resolve holdout rows and inspect their nutrition only after locking.
    Object.freeze(selected);
    const holdoutProfiles = ROUNDING_COHORT.holdout.map(([name, label]) =>
      [requireTacoRow(name), label] as const);
    const calibrationFoodSlugs = calibrationProfiles.map(([row]) => row.slug);
    const holdoutFoodSlugs = holdoutProfiles.map(([row]) => row.slug);
    expect(new Set([...calibrationFoodSlugs, ...holdoutFoodSlugs]).size)
      .toBe(calibrationFoodSlugs.length + holdoutFoodSlugs.length);
    const holdout: RoundingSample[] = [];
    for (const [row, label] of holdoutProfiles) {
      for (const scenario of ROUNDING_QUANTITY_SCENARIOS) {
        holdout.push({
          profile: row.slug + "@" + scenario.grams + "g",
          deltas: await measureEquivalentPair(row, label, scenario),
        });
      }
    }
    const holdoutMax = maxByField(holdout.map(sample => sample.deltas));
    for (const field of CORE_FIELDS) {
      expect(holdoutMax[field]).toBeLessThanOrEqual(selected[field]);
    }

    const calibrationCandidateMetrics = Object.fromEntries(CORE_FIELDS.map(field => [
      field,
      candidatesForField(field).map(candidate => evaluateRoundingCandidate(calibration, field, candidate)),
    ]));
    const baselineComparison = Object.fromEntries(CORE_FIELDS.map(field => [
      field, comparisonToBaseline(calibration, field, selected[field]),
    ]));
    const holdoutSelectedMetrics = Object.fromEntries(CORE_FIELDS.map(field => [
      field, evaluateRoundingCandidate(holdout, field, selected[field]),
    ])) as Record<CoreField, RoundingCandidateMetric>;
    const selectedCalibrationMetrics = CORE_FIELDS.map(field =>
      evaluateRoundingCandidate(calibration, field, selected[field]));
    const selectedHoldoutMetrics = CORE_FIELDS.map(field => holdoutSelectedMetrics[field]);
    const failuresByClass = mergeFailureClasses([
      ...selectedCalibrationMetrics, ...selectedHoldoutMetrics,
    ]);
    expect(failuresByClass).toEqual({});

    console.info("C3_ITEM30_ROUNDING_CAMPAIGN " + JSON.stringify({
      source: { kind: "TACO_4E", reference: TACO_PRIMARY_SOURCE },
      splitPolicy: "candidate-selected-from-calibration-before-holdout",
      baselinePolicy: "open-fail-closed-zero-divergence",
      cohortRevision: "c3-rounding-expanded-v2",
      quantityGrams: ROUNDING_QUANTITY_SCENARIOS.map(scenario => scenario.grams),
      calibrationFoodProfiles: calibrationFoodSlugs,
      holdoutFoodProfiles: holdoutFoodSlugs,
      candidates: { caloriesKcal: ENERGY_CANDIDATES, macroGrams: MACRO_CANDIDATES },
      calibrationProfiles: calibration.map(sample => sample.profile),
      holdoutProfiles: holdout.map(sample => sample.profile),
      calibrationMaxDelta: calibrationMax,
      calibrationCandidateMetrics,
      selectedTolerance: selected,
      comparisonToBaseline: baselineComparison,
      holdoutMaxDelta: holdoutMax,
      holdoutSelectedMetrics,
      failuresByClass,
    }));
  });

  it("rejects TACO source rows with absent core nutrition instead of treating zeros as truth", () => {
    expect(() => requireTacoRow("Leite, de vaca, integral")).toThrow(/absent core nutrition/);
  });

  it("reports discriminating failure classes and comparison deltas for rounding candidates", () => {
    const samples: RoundingSample[] = [{
      profile: "synthetic-rounding-control",
      deltas: { calories: 0.02, protein: 0, carbs: 0, fat: 0 },
    }];
    const baseline = evaluateRoundingCandidate(samples, "calories", 0);
    const relaxed = evaluateRoundingCandidate(samples, "calories", 0.1);
    const comparison = comparisonToBaseline(samples, "calories", 0.1);
    expect(baseline).toMatchObject({
      cases: 1, passed: 0, failed: 1,
      failuresByClass: { "rounding_delta_exceeds_candidate:calories": 1 },
    });
    expect(relaxed).toMatchObject({ cases: 1, passed: 1, failed: 0, failuresByClass: {} });
    expect(comparison).toMatchObject({ passedDelta: 1, failedDelta: -1 });
  });

  it("measures why the remaining C3 decisions cannot be promoted from current repository evidence", async () => {
    const cases = goldenFoodCorpus.cases;
    const nutritionOrigins = new Set(
      cases.flatMap(entry => entry.expected.decisions.flatMap(
        decision => decision.nutrition.allowedOrigins,
      )),
    );
    const confidenceLabels = cases.reduce(
      (total, entry) => total + entry.expected.decisions.filter(
        decision => Object.prototype.hasOwnProperty.call(decision, "confidence"),
      ).length,
      0,
    );
    const familyAnchorLabels = cases.reduce(
      (total, entry) => total + entry.expected.decisions.filter(
        decision => Object.prototype.hasOwnProperty.call(decision, "genericAnchor"),
      ).length,
      0,
    );
    const estimatePolicyLabels = cases.reduce(
      (total, entry) => total + entry.expected.decisions.filter(
        decision => Object.prototype.hasOwnProperty.call(decision, "estimatePolicy"),
      ).length,
      0,
    );
    const materialityLabels = cases.reduce(
      (total, entry) => total + entry.expected.decisions.filter(
        decision => Object.prototype.hasOwnProperty.call(decision, "materiality"),
      ).length,
      0,
    );

    const resolverSource = await readFile(new URL("../resolver.ts", import.meta.url), "utf8");
    const residualContractMentions =
      resolverSource.match(/ResidualFoodCandidateSearch/g)?.length ?? 0;

    let interpreterCalls = 0;
    await comprehendFoodLanguage(
      {
        rawText: "superfície residual sem regra governada",
        sourceRef: "c3:s3-readiness",
        modality: "text",
        ownerUserId: 1306,
        lexiconRevision: "c3-readiness-v1",
      },
      { async load() { return []; } },
      async () => {
        interpreterCalls += 1;
        return { alternatives: [] };
      },
    );

    const taco = getTacoCatalog();
    const zeroCoreProfiles = taco.filter(row =>
      [row.calories, row.protein, row.carbs, row.fat].every(value => value === 0),
    ).length;
    const itemsCovered = new Set(Object.values(CALIBRATION_PARAMETERS).map(item => item.item));
    expect([...itemsCovered].sort((a, b) => a - b)).toEqual([2, 7, 8, 17, 19, 22, 30]);
    expect(confidenceLabels).toBe(0);
    expect(familyAnchorLabels).toBe(0);
    expect(estimatePolicyLabels).toBe(0);
    expect(materialityLabels).toBe(0);
    expect(residualContractMentions).toBe(1);
    expect(interpreterCalls).toBe(0);
    expect(taco.length).toBeGreaterThanOrEqual(597);
    expect(zeroCoreProfiles).toBeGreaterThan(0);

    console.info("C3_OPEN_EVIDENCE_READINESS " + JSON.stringify({
      corpusCases: cases.length,
      splits: Object.fromEntries(["acquisition", "calibration", "holdout"].map(split => [
        split, cases.filter(entry => entry.split === split).length,
      ])),
      nutritionOrigins: [...nutritionOrigins].sort(),
      tacoRows: taco.length,
      tacoRowsWithoutCoreMacros: zeroCoreProfiles,
      blockers: {
        "2": ["confidence_labels_by_source_and_field_absent"],
        "7": ["governed_family_anchor_ground_truth_absent"],
        "8": ["residual_semantic_search_contract_not_consumed", "external_calls_budget_zero"],
        "17": ["s3_default_not_eligible", "external_calls_budget_zero"],
        "19": ["estimate_policy_ground_truth_absent"],
        "22": ["governed_materiality_labels_absent", "source_rows_with_missing_core_values"],
      },
    }));
  });
});
