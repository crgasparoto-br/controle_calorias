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
import { CALIBRATION_PARAMETERS } from "./calibration.test.support";

const TACO_PRIMARY_SOURCE =
  "https://nepa.unicamp.br/wp-content/uploads/sites/27/2023/10/taco_4_edicao_ampliada_e_revisada.pdf";

const ENERGY_CANDIDATES = [0, 1e-12, 1e-9, 1e-6, 0.001, 0.01, 0.1] as const;
const MACRO_CANDIDATES = [0, 1e-12, 1e-9, 1e-6, 0.0001, 0.001, 0.01, 0.1] as const;
const CORE_FIELDS = ["calories", "protein", "carbs", "fat"] as const;
type CoreField = (typeof CORE_FIELDS)[number];
type CoreValues = Record<CoreField, number>;

type TacoRow = ReturnType<typeof getTacoCatalog>[number];

function requireTacoRow(name: string): TacoRow {
  const row = getTacoCatalog().find(item => item.name === name);
  if (!row) throw new Error("C3 source profile missing: " + name);
  for (const value of [row.calories, row.protein, row.carbs, row.fat]) {
    if (!Number.isFinite(value)) throw new Error("C3 invalid source profile: " + name);
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

async function resolveCore(row: TacoRow, surface: string): Promise<CoreValues> {
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
  expect(decisions[0].quantity.grams!).toBeCloseTo(30, 10);
  const consumed = decisions[0].nutrition.consumed;
  expect(consumed).not.toBeNull();
  if (!consumed) throw new Error("C3 nutrition sample missing");
  return {
    calories: consumed.calories!,
    protein: consumed.protein!,
    carbs: consumed.carbs!,
    fat: consumed.fat!,
  };
}

async function measureEquivalentPair(row: TacoRow, label: string) {
  const grams = await resolveCore(row, "30 g de " + label);
  const kilograms = await resolveCore(row, "0,03 kg de " + label);
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

describe("#1306 C3 empirical evidence campaign", () => {
  it("selects rounding candidates only from calibration and validates them on reserved profiles", async () => {
    const calibrationProfiles = [
      [requireTacoRow("Mortadela"), "mortadela"],
      [requireTacoRow("Amendoim, grão, cru"), "amendoim cru"],
    ] as const;
    const holdoutProfiles = [
      [requireTacoRow("Iogurte, natural"), "iogurte natural"],
      [requireTacoRow("Pêra, Williams, crua"), "pêra Williams"],
    ] as const;

    const calibration = [];
    for (const [row, label] of calibrationProfiles) {
      calibration.push(await measureEquivalentPair(row, label));
    }
    const calibrationMax = maxByField(calibration);
    const selected = Object.fromEntries(
      CORE_FIELDS.map(field => [field, selectCandidate(field, calibrationMax[field])]),
    ) as CoreValues;

    // The reserved set is opened only after the candidate map is frozen.
    Object.freeze(selected);
    const holdout = [];
    for (const [row, label] of holdoutProfiles) {
      holdout.push(await measureEquivalentPair(row, label));
    }
    const holdoutMax = maxByField(holdout);
    for (const field of CORE_FIELDS) {
      expect(holdoutMax[field]).toBeLessThanOrEqual(selected[field]);
    }

    console.info("C3_ITEM30_ROUNDING_CAMPAIGN " + JSON.stringify({
      source: { kind: "TACO_4E", reference: TACO_PRIMARY_SOURCE },
      splitPolicy: "candidate-selected-from-calibration-before-holdout",
      candidates: { caloriesKcal: ENERGY_CANDIDATES, macroGrams: MACRO_CANDIDATES },
      calibrationProfiles: calibrationProfiles.map(([row]) => row.slug),
      holdoutProfiles: holdoutProfiles.map(([row]) => row.slug),
      calibrationMaxDelta: calibrationMax,
      selectedTolerance: selected,
      holdoutMaxDelta: holdoutMax,
    }));
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
    const itemsCovered = new Set(CALIBRATION_PARAMETERS.map(item => item.adrItem));
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
