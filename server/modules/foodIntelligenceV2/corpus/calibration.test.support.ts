/**
 * Issue #1306 — experimental C3 selection, never a production threshold policy.
 * This module only compares independently labelled Golden Corpus measurements.
 * It cannot authorize an estimate, similarity match, S3 call or macro tolerance.
 */
import { createHash } from "node:crypto";
import {
  CORPUS_REVISION_KEYS,
  GOLDEN_CORPUS_MIN_MATCH_RATE,
  isUnpinnedRevision,
  type CorpusRevisions,
  type CorpusGateStatus,
  CORPUS_DECISION_CLASSES,
  type GoldenCorpus,
  type GoldenCorpusCase,
} from "./contracts";
import { segmentKeysOf, type CorpusReport } from "./harness";

export const CALIBRATION_PARAMETERS = {
  "confidence:source-field": { item: 2, unit: "probability", objective: "Minimize incorrect acceptance for each independently verified source and field." },
  "search:text-algorithm": { item: 8, unit: "algorithm_id", objective: "Compare textual retrieval against the exact baseline without erasing brand, negation or variant." },
  "search:candidate-limit": { item: 8, unit: "candidate_count", objective: "Bound candidate count while retaining correct identity and relevant alternatives." },
  "search:semantic-similarity": { item: 8, unit: "similarity", objective: "Distinguish residual semantic matches from unsupported semantic guesses." },
  "search:top-margin": { item: 8, unit: "similarity_margin", objective: "Keep materially tied candidates ambiguous instead of accepting the first one." },
  "linguistic:s3-escalation": { item: 17, unit: "probability", objective: "Escalate only residual S1/S2 uncertainty without introducing false acceptance." },
  "estimate:family-dispersion": { item: 7, unit: "relative_spread", objective: "Distinguish low, intermediate and high nutrient dispersion." },
  "estimate:generic-anchor": { item: 7, unit: "anchor_policy_id", objective: "Require a defensible and authorized generic nutrition anchor." },
  "estimate:caloric-impact": { item: 7, unit: "kcal_per_100g", objective: "Bound calorie impact of an approximate estimate." },
  "estimate:ladder-policy": { item: 19, unit: "policy_id", objective: "Compare all seven coverage outcomes without inventing generic nutrition." },
  "materiality:profile-kcal": { item: 22, unit: "kcal_per_100g", objective: "Detect pairwise energetic divergence between comparable variants." },
  "materiality:profile-macros": { item: 22, unit: "g_per_100g", objective: "Detect pairwise protein, carbohydrate and fat divergence." },
  "materiality:sparse-family": { item: 22, unit: "minimum_variant_pairs", objective: "Never certify immateriality with insufficient comparable variants." },
  "rounding:energy": { item: 30, unit: "kcal", objective: "Bound rounding differences between equivalent measured consumptions." },
  "rounding:macros": { item: 30, unit: "g", objective: "Bound rounding differences for each declared macro independently." },
} as const;

export type CalibrationParameter = keyof typeof CALIBRATION_PARAMETERS;
export type CalibrationUnit = (typeof CALIBRATION_PARAMETERS)[CalibrationParameter]["unit"];

export interface CalibrationCandidate {
  id: string;
  value: number | string;
  /** Policy/model identifiers actually exercised by the candidate, not a claim of approval. */
  policyRevision: string;
}
export interface CalibrationPlan {
  id: string;
  parameter: CalibrationParameter;
  /** Example: source=label;field=protein or family=milk;attribute=fat. Never 'all'. */
  scope: string;
  preRegisteredAt: string;
  owner: string;
  reference: string;
  corpusVersion: string;
  resolverId: string;
  revisions: CorpusRevisions;
  baseline: CalibrationCandidate;
  /** Candidate order is the final deterministic tie break, fixed before measurement. */
  candidates: readonly CalibrationCandidate[];
  selectionRule: "no_regression_then_max_correct_then_cost";
  /** C3 works offline; outbound experiments require a separately approved budget. */
  maxExternalCalls: 0;
}

export interface PreRegisteredCalibrationDefinition {
  /** Observed comparison point only; null means there is no approved V2 baseline value. */
  baseline: Readonly<{ value: number | string | null; reference: string }>;
  /** Experimental candidates fixed before results. They are never production policy by themselves. */
  candidates: readonly (number | string)[];
  selectionCriterion: string;
  /** Evidence that must exist before this parameter can be evaluated or promoted. */
  blockedUntil: readonly string[];
}

function steppedCandidates(start: number, end: number, step: number): readonly number[] {
  const values: number[] = [];
  for (let value = start; value <= end + step / 1000; value += step) {
    values.push(Number(value.toFixed(12)));
  }
  return Object.freeze(values);
}

function integerCandidates(start: number, end: number): readonly number[] {
  return Object.freeze(Array.from({ length: end - start + 1 }, (_, index) => start + index));
}

/**
 * #1306 C3 pre-registration.
 *
 * Candidate grids are evaluation inputs, not approved thresholds. Numerical grids
 * are bounded by the unit's mathematical/physical domain; policy/algorithm IDs
 * name experimental configurations to compare once their required ground truth
 * is available. Missing evidence keeps the item OPEN instead of selecting a value.
 */
export const C3_PRE_REGISTERED_PARAMETER_DEFINITIONS:
Readonly<Record<CalibrationParameter, PreRegisteredCalibrationDefinition>> = Object.freeze({
  "confidence:source-field": {
    baseline: { value: null, reference: "ADR §25 item 2: V2 confidence matrix OPEN" },
    candidates: steppedCandidates(0, 1, 0.05),
    selectionCriterion: "Per source×field, maximize correct verified acceptance with zero incompatible acceptance; ties choose the more conservative threshold and may not regress any case or segment.",
    blockedUntil: ["independent_confidence_labels_by_source_and_field"],
  },
  "search:text-algorithm": {
    baseline: { value: "v1-catalog-score", reference: "server/catalogMatching.ts::findCatalogFood" },
    candidates: Object.freeze(["v1-exact-substring-only", "v2-governed-lexical-score"]),
    selectionCriterion: "Replay the same labeled identities against the V1 textual baseline and each textual candidate; require no brand/negation/variant regression, then prefer fewer false candidates and lower cost/latency.",
    blockedUntil: ["governed_textual_replay_ground_truth"],
  },
  "search:candidate-limit": {
    baseline: { value: null, reference: "ADR §9.5: V2 candidate limit OPEN" },
    candidates: integerCandidates(1, 20),
    selectionCriterion: "Choose the smallest candidate limit that preserves every correct eligible identity/alternative relative to baseline with no case or segment regression.",
    blockedUntil: ["governed_search_replay_ground_truth"],
  },
  "search:semantic-similarity": {
    baseline: { value: 0.82, reference: "server/catalogSemanticSearchCore.ts::SIMILARITY_THRESHOLD (V1 observation only)" },
    candidates: steppedCandidates(0, 1, 0.05),
    selectionCriterion: "On authorized paired textual×semantic replay, require zero incompatible semantic acceptance and no correct-match regression; ties choose the higher, more conservative similarity threshold.",
    blockedUntil: ["authorized_embedding_replay", "governed_search_replay_ground_truth"],
  },
  "search:top-margin": {
    baseline: { value: null, reference: "ADR §9.5: material tie margin OPEN" },
    candidates: steppedCandidates(0, 1, 0.05),
    selectionCriterion: "Choose the smallest margin that keeps every labeled material tie ambiguous while preserving correct singleton decisions and all baseline cases.",
    blockedUntil: ["governed_search_replay_ground_truth"],
  },
  "linguistic:s3-escalation": {
    baseline: { value: null, reference: "ADR §25 item 17: S1/S2→S3 threshold OPEN" },
    candidates: steppedCandidates(0, 1, 0.05),
    selectionCriterion: "Preserve or improve labeled correctness with no new false acceptance, then minimize S3 invocation cost/latency; a candidate cannot win without observed external-cost reduction.",
    blockedUntil: ["authorized_s3_trials", "s3_error_cost_latency_ground_truth"],
  },
  "estimate:family-dispersion": {
    baseline: { value: null, reference: "ADR §10.1/§25 item 7: dispersion boundary OPEN" },
    candidates: steppedCandidates(0, 2, 0.1),
    selectionCriterion: "Choose boundaries that separate labeled safe/intermediate/unsafe estimate families without permitting a labeled unsafe estimate; ties choose the more conservative boundary.",
    blockedUntil: ["governed_family_anchor_impact_ground_truth"],
  },
  "estimate:generic-anchor": {
    baseline: { value: null, reference: "ADR §10.1/§25 item 7: generic-anchor policy OPEN" },
    candidates: Object.freeze(["verified-generic-variant", "verified-family-preparation", "no-provisional-estimate"]),
    selectionCriterion: "Require an independently verified anchor for every provisional estimate; reject any policy that produces an ungrounded estimate, then prefer the strongest provenance with no coverage regression.",
    blockedUntil: ["governed_family_anchor_impact_ground_truth"],
  },
  "estimate:caloric-impact": {
    baseline: { value: null, reference: "ADR §10.1/§25 item 7: caloric-impact boundary OPEN" },
    candidates: steppedCandidates(0, 900, 25),
    selectionCriterion: "Using labeled estimate error by family, reject any boundary that permits a high-impact unsafe estimate; among non-regressing candidates choose the lowest risk-adjusted kcal/100g boundary.",
    blockedUntil: ["governed_family_anchor_impact_ground_truth"],
  },
  "estimate:ladder-policy": {
    baseline: { value: null, reference: "ADR §9.2/§25 item 19: numeric ladder policy OPEN" },
    candidates: Object.freeze(["strict-no-estimate", "estimate-low-only", "estimate-low-and-intermediate-with-review"]),
    selectionCriterion: "Evaluate all seven §9.2 outcomes against labeled expected policy; zero unsupported estimates/hidden fallbacks is mandatory, then choose the most useful policy with no baseline regression.",
    blockedUntil: ["estimate_policy_ground_truth_by_family_and_anchor"],
  },
  "materiality:profile-kcal": {
    baseline: { value: null, reference: "ADR §9.1.1/§25 item 22: kcal materiality OPEN" },
    candidates: steppedCandidates(0, 900, 25),
    selectionCriterion: "Against governed comparable-variant labels, reject every threshold that marks a labeled material kcal divergence immaterial; ties choose the lower divergence tolerance.",
    blockedUntil: ["governed_materiality_labels", "comparable_variant_pairs"],
  },
  "materiality:profile-macros": {
    baseline: { value: null, reference: "ADR §9.1.1/§25 item 22: macro materiality OPEN" },
    candidates: steppedCandidates(0, 100, 5),
    selectionCriterion: "Per macro and family, reject every threshold that hides a labeled material g/100g divergence; ties choose the lower tolerance and must not share the rounding policy.",
    blockedUntil: ["governed_materiality_labels", "comparable_variant_pairs"],
  },
  "materiality:sparse-family": {
    baseline: { value: null, reference: "ADR §25 item 22: sparse-family rule OPEN" },
    candidates: integerCandidates(1, 20),
    selectionCriterion: "Choose the minimum comparable-pair count after which labeled immateriality remains stable; any false immateriality blocks the candidate.",
    blockedUntil: ["governed_materiality_labels", "comparable_variant_pairs"],
  },
  "rounding:energy": {
    baseline: { value: null, reference: "ADR §25 item 30: current OPEN policy is fail-closed on divergence" },
    candidates: Object.freeze([0, 1e-12, 1e-9, 1e-6, 0.001, 0.01, 0.1]),
    selectionCriterion: "Select the smallest kcal tolerance covering every calibration-equivalent pair; freeze it before opening holdout and reject on any reserved exceedance.",
    blockedUntil: ["independent_nominal_approval"],
  },
  "rounding:macros": {
    baseline: { value: null, reference: "ADR §25 item 30: current OPEN policy is fail-closed on divergence" },
    candidates: Object.freeze([0, 1e-12, 1e-9, 1e-6, 0.0001, 0.001, 0.01, 0.1]),
    selectionCriterion: "For each macro independently, select the smallest gram tolerance covering every calibration-equivalent pair; freeze before holdout and reject on any reserved exceedance.",
    blockedUntil: ["independent_nominal_approval"],
  },
});

export interface CalibrationSegment {
  dimension: "modality" | "brand" | "measure" | "decisionClass" | "nonRecurrenceClass";
  label: string;
  cases: number;
  resolvableLabeled: number;
  matchedResolvable: number;
  failedCases: number;
}
/** Independent expectation labels and observed failures, never resolver answers. */
export interface CalibrationCaseFact {
  caseId: string;
  decisionClass: GoldenCorpusCase["decisionClass"];
  nonRecurrenceClasses: string[];
  modality: string;
  brand: string;
  measure: string;
  failed: boolean;
}

/** The global gate is recorded but not consumed during calibration selection:
 * holdout failure must never influence which candidate is selected. It is
 * mandatory, however, before any result can await external approval. */
export interface CalibrationCorpusGate {
  status: CorpusGateStatus;
  blockReasons: string[];
}

export interface SplitEvidence {
  planId: string;
  candidateId: string;
  runId: string;
  recordedAt: string;
  split: "calibration" | "holdout";
  corpusVersion: string;
  resolverId: string;
  revisions: CorpusRevisions;
  cases: number;
  resolvableLabeled: number;
  matchedResolvable: number;
  failedCases: number;
  nonResolvableFailures: number;
  abstentions: number;
  matchedCases: number;
  totalCostUsd: number | null;
  costSamples: number;
  totalLatencyMs: number | null;
  latencySamples: number;
  failuresByClass: Record<string, number>;
  /** Per-case evidence avoids compensating one new regression with another improvement. */
  failedCaseIds: string[];
  caseFacts: CalibrationCaseFact[];
  segments: CalibrationSegment[];
  corpusGate: CalibrationCorpusGate;
  /** Structural integrity failures block comparison, never become tuning feedback. */
  structuralViolations: string[];
}

const validDate = (value: string): number => {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || !value.includes("T")) throw new Error("calibration: invalid timestamp");
  return time;
};

function assertCandidate(candidate: CalibrationCandidate, unit: CalibrationUnit): void {
  if (!candidate.id?.trim() || !candidate.policyRevision?.trim() ||
      isUnpinnedRevision(candidate.policyRevision)) {
    throw new Error("calibration: candidate identity or policy revision missing");
  }
  if (unit === "algorithm_id" || unit === "anchor_policy_id" || unit === "policy_id") {
    if (typeof candidate.value !== "string" || !candidate.value.trim()) {
      throw new Error("calibration: expected a versioned algorithm/policy identifier");
    }
  } else {
    if (typeof candidate.value !== "number" || !Number.isFinite(candidate.value)) {
      throw new Error("calibration: expected finite numeric candidate");
    }
    if (unit === "probability" && (candidate.value < 0 || candidate.value > 1)) {
      throw new Error("calibration: probability outside [0,1]");
    }
    if (unit === "similarity" && (candidate.value < -1 || candidate.value > 1)) {
      throw new Error("calibration: similarity outside [-1,1]");
    }
    if (unit === "similarity_margin" && (candidate.value < 0 || candidate.value > 2)) {
      throw new Error("calibration: invalid similarity margin");
    }
    if ((unit === "candidate_count" || unit === "minimum_variant_pairs") &&
        (!Number.isSafeInteger(candidate.value) || candidate.value < 1)) {
      throw new Error("calibration: candidate count must be a positive integer");
    }
    if (!["probability", "similarity", "similarity_margin", "candidate_count", "minimum_variant_pairs"].includes(unit) &&
        candidate.value < 0) {
      throw new Error("calibration: negative physical tolerance");
    }
  }
}

export function verifyCalibrationPlan(plan: CalibrationPlan): void {
  if (!plan.id?.trim() || !plan.owner?.trim() || !plan.reference?.trim() ||
      !plan.resolverId?.trim() || !plan.corpusVersion?.trim() ||
      !plan.scope?.trim() || /^(all|global|\*)$/i.test(plan.scope.trim()) ||
      !CALIBRATION_PARAMETERS[plan.parameter] ||
      plan.selectionRule !== "no_regression_then_max_correct_then_cost" ||
      plan.maxExternalCalls !== 0) {
    throw new Error("calibration: incomplete prior protocol, scope or unsupported external budget");
  }
  validDate(plan.preRegisteredAt);
  if (plan.parameter === "confidence:source-field" &&
      !/source=[^;]+;field=[^;]+/.test(plan.scope)) {
    throw new Error("calibration: confidence requires explicit source and field");
  }
  if (plan.parameter.startsWith("materiality:") && !/family=[^;]+/.test(plan.scope)) {
    throw new Error("calibration: materiality requires governed family scope");
  }
  if (plan.parameter.startsWith("rounding:") && !/macro=[^;]+/.test(plan.scope)) {
    throw new Error("calibration: rounding requires a specific nutrient scope");
  }
  if (CORPUS_REVISION_KEYS.some(key => isUnpinnedRevision(plan.revisions[key]))) {
    throw new Error("calibration: unpinned revision");
  }
  if (!plan.candidates.length) throw new Error("calibration: no candidate range");
  const unit = CALIBRATION_PARAMETERS[plan.parameter].unit;
  if (plan.baseline.policyRevision !== plan.revisions.policy) {
    throw new Error("calibration: baseline policy revision is not pinned");
  }
  const all = [plan.baseline, ...plan.candidates];
  all.forEach(candidate => assertCandidate(candidate, unit));
  if (new Set(all.map(candidate => candidate.id)).size !== all.length ||
      new Set(all.map(candidate => JSON.stringify(candidate.value))).size !== all.length) {
    throw new Error("calibration: duplicate candidate identity or value");
  }
}

function segmentsFor(
  entries: readonly GoldenCorpusCase[],
  failed: ReadonlySet<string>,
): CalibrationSegment[] {
  const dimensions = ["modality", "brand", "measure", "decisionClass", "nonRecurrenceClass"] as const;
  const out: CalibrationSegment[] = [];
  for (const dimension of dimensions) {
    const keys = new Map<string, GoldenCorpusCase[]>();
    for (const entry of entries) {
      const dimensionValue = segmentKeysOf(entry)[dimension];
      const labels: readonly string[] =
        typeof dimensionValue === "string" ? [dimensionValue] : dimensionValue;
      for (const label of labels) keys.set(label, [...(keys.get(label) ?? []), entry]);
    }
    for (const [label, cases] of keys) {
      out.push({
        dimension, label, cases: cases.length,
        resolvableLabeled: cases.filter(c => c.decisionClass === "resolvable").length,
        matchedResolvable: cases.filter(c => c.decisionClass === "resolvable" && !failed.has(c.caseId)).length,
        failedCases: cases.filter(c => failed.has(c.caseId)).length,
      });
    }
  }
  return out.sort((a, b) => a.dimension.localeCompare(b.dimension) || a.label.localeCompare(b.label));
}

/** Each exhaustive dimension counts each case exactly once. Non-recurrence
 * classes may overlap, so they are rebuilt from case identities independently. */
function segmentsFromFacts(facts: readonly CalibrationCaseFact[]): CalibrationSegment[] {
  const dimensions = ["modality", "brand", "measure", "decisionClass", "nonRecurrenceClass"] as const;
  const out: CalibrationSegment[] = [];
  for (const dimension of dimensions) {
    const grouped = new Map<string, CalibrationCaseFact[]>();
    for (const fact of facts) {
      const value = dimension === "nonRecurrenceClass" ? fact.nonRecurrenceClasses : fact[dimension];
      for (const label of typeof value === "string" ? [value] : value) {
        grouped.set(label, [...(grouped.get(label) ?? []), fact]);
      }
    }
    for (const [label, cases] of grouped) {
      out.push({
        dimension, label, cases: cases.length,
        resolvableLabeled: cases.filter(c => c.decisionClass === "resolvable").length,
        matchedResolvable: cases.filter(c => c.decisionClass === "resolvable" && !c.failed).length,
        failedCases: cases.filter(c => c.failed).length,
      });
    }
  }
  return out.sort((a, b) => a.dimension.localeCompare(b.dimension) || a.label.localeCompare(b.label));
}

function failuresByFacts(facts: readonly CalibrationCaseFact[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of facts) {
    if (!item.failed) continue;
    for (const name of ["decision:" + item.decisionClass,
      ...item.nonRecurrenceClasses.map(code => "nonrecurrence:" + code)]) {
      counts[name] = (counts[name] ?? 0) + 1;
    }
  }
  return counts;
}

const canonicalCounts = (counts: Record<string, number>): string =>
  JSON.stringify(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));

/**
 * One-way projection: the selection API never receives a CorpusReport or holdout
 * results. Failure and segment calculations use ONLY labelled cases in the
 * requested split, not global (holdout-contaminated) byModality/byBrand arrays.
 */
export function projectSplitEvidence(
  corpus: GoldenCorpus,
  report: CorpusReport,
  planId: string,
  candidateId: string,
  runId: string,
  recordedAt: string,
  split: "calibration" | "holdout",
): SplitEvidence {
  validDate(recordedAt);
  const entries = corpus.cases.filter(c => c.split === split);
  if (!entries.length || report.corpusVersion !== corpus.corpusVersion ||
      report.caseCount !== corpus.cases.length || report.resolveCalls !== report.caseCount) {
    throw new Error("calibration: missing split, corpus mismatch or unexecuted cases");
  }
  const splitMetric = report.bySplit.find(item => item.segment === split);
  if (!splitMetric || splitMetric.cases !== entries.length) {
    throw new Error("calibration: incomplete split metrics");
  }
  const ids = new Set(entries.map(c => c.caseId));
  const failures = report.failures.filter(failure => ids.has(failure.caseId));
  const failed = new Set(failures.map(failure => failure.caseId));
  const matchedResolvable = entries.filter(c =>
    c.decisionClass === "resolvable" && !failed.has(c.caseId)).length;
  const nonResolvableFailures = entries.filter(c =>
    c.decisionClass !== "resolvable" && failed.has(c.caseId)).length;
  const expectedRate = splitMetric.resolvableLabeled
    ? matchedResolvable / splitMetric.resolvableLabeled : null;
  if (splitMetric.resolvableLabeled !== entries.filter(c => c.decisionClass === "resolvable").length ||
      splitMetric.matchedCases !== entries.length - failed.size ||
      splitMetric.failedCases !== failed.size ||
      (expectedRate !== null && (splitMetric.matchRate === null ||
        Math.abs(splitMetric.matchRate - expectedRate) > 1e-10))) {
    throw new Error("calibration: harness counters inconsistent with independent labels");
  }
  const caseFacts: CalibrationCaseFact[] = entries.map(entry => {
    const labels = segmentKeysOf(entry);
    return {
      caseId: entry.caseId, decisionClass: entry.decisionClass,
      nonRecurrenceClasses: [...entry.nonRecurrenceClasses], modality: labels.modality,
      brand: labels.brand, measure: labels.measure, failed: failed.has(entry.caseId),
    };
  }).sort((a, b) => a.caseId.localeCompare(b.caseId));
  const failuresByClass = failuresByFacts(caseFacts);
  const structuralViolations: string[] = [];
  if (report.integrity.status !== "valid" || !report.integrity.reference.verified ||
      report.integrity.splitLeakage.length > 0) structuralViolations.push("corpus_integrity");
  if (report.integrity.holdoutKnowledgeWrites.length ||
      report.integrity.knowledgeWritesOutside.length ||
      report.integrity.knowledgeWritesAfterStep.length) structuralViolations.push("knowledge_write");
  if (report.resolver.id.startsWith("self-test:")) structuralViolations.push("synthetic_resolver");
  // This is a global signal and may include holdout failures. Keep it out of
  // parameter selection; enforce it at the separate approval boundary.
  const gate = report.gate;
  const corpusGate: CalibrationCorpusGate = gate
    ? { status: gate.status, blockReasons: [...gate.blockReasons] }
    : { status: "blocked", blockReasons: ["gate_missing"] };
  if (gate?.status === "passed" && report.failures.length > 0) {
    structuralViolations.push("corpus_gate_inconsistent");
  }
  if (CORPUS_REVISION_KEYS.some(key => isUnpinnedRevision(report.revisions[key])) ||
      report.resolver.revision !== report.revisions.resolver) structuralViolations.push("revision_mismatch");
  return {
    planId, candidateId, runId, recordedAt, split,
    corpusVersion: report.corpusVersion, resolverId: report.resolver.id,
    revisions: { ...report.revisions }, cases: entries.length,
    resolvableLabeled: splitMetric.resolvableLabeled, matchedResolvable,
    failedCases: failed.size, nonResolvableFailures,
    abstentions: splitMetric.abstentions, matchedCases: splitMetric.matchedCases,
    totalCostUsd: splitMetric.totalCostUsd, costSamples: splitMetric.costSamples,
    totalLatencyMs: splitMetric.totalLatencyMs, latencySamples: splitMetric.latencySamples,
    failuresByClass, failedCaseIds: [...failed].sort(), caseFacts,
    segments: segmentsFor(entries, failed), corpusGate, structuralViolations,
  };
}

function assertEvidence(
  plan: CalibrationPlan, candidate: CalibrationCandidate,
  evidence: SplitEvidence, expectedSplit: SplitEvidence["split"],
): void {
  if (evidence.planId !== plan.id || evidence.candidateId !== candidate.id ||
      evidence.split !== expectedSplit || evidence.corpusVersion !== plan.corpusVersion ||
      evidence.resolverId !== plan.resolverId || !evidence.runId?.trim() ||
      validDate(evidence.recordedAt) <= validDate(plan.preRegisteredAt) ||
      evidence.structuralViolations.length ||
      evidence.revisions.policy !== candidate.policyRevision ||
      CORPUS_REVISION_KEYS.some(key => key !== "policy" &&
        evidence.revisions[key] !== plan.revisions[key])) {
    throw new Error("calibration: evidence lacks provenance, identity or pre-registration");
  }
  if (evidence.cases <= 0 || evidence.resolvableLabeled <= 0 ||
      evidence.matchedResolvable < 0 || evidence.matchedResolvable > evidence.resolvableLabeled ||
      evidence.matchedResolvable > evidence.matchedCases ||
      !Number.isSafeInteger(evidence.failedCases) || !Number.isSafeInteger(evidence.abstentions) ||
      !Number.isSafeInteger(evidence.costSamples) || evidence.costSamples < 0 ||
      evidence.costSamples > evidence.cases ||
      (evidence.totalCostUsd !== null && (!Number.isFinite(evidence.totalCostUsd) || evidence.totalCostUsd < 0)) ||
      (evidence.totalLatencyMs !== null && (!Number.isFinite(evidence.totalLatencyMs) || evidence.totalLatencyMs < 0)) ||
      evidence.matchedCases < 0 || evidence.matchedCases > evidence.cases ||
      evidence.failedCases !== evidence.cases - evidence.matchedCases ||
      evidence.nonResolvableFailures < 0 || evidence.abstentions < 0 ||
      !Number.isSafeInteger(evidence.cases) || !Number.isSafeInteger(evidence.resolvableLabeled) ||
      evidence.failedCaseIds.length !== evidence.failedCases ||
      new Set(evidence.failedCaseIds).size !== evidence.failedCaseIds.length) {
    throw new Error("calibration: missing or invalid denominator");
  }
  // Reconstruct every published aggregate from individually-labelled cases.
  // This catches bogus segment/class counters even when global rate improves.
  if (!Array.isArray(evidence.caseFacts) || evidence.caseFacts.length !== evidence.cases ||
      evidence.caseFacts.some(fact =>
        !fact || typeof fact.caseId !== "string" || !fact.caseId.trim() ||
        !CORPUS_DECISION_CLASSES.includes(fact.decisionClass) ||
        !Array.isArray(fact.nonRecurrenceClasses) ||
        fact.nonRecurrenceClasses.some(value => typeof value !== "string" || !value.trim()) ||
        new Set(fact.nonRecurrenceClasses).size !== fact.nonRecurrenceClasses.length ||
        [fact.modality, fact.brand, fact.measure].some(value => typeof value !== "string" || !value.trim()) ||
        typeof fact.failed !== "boolean") ||
      new Set(evidence.caseFacts.map(f => f.caseId)).size !== evidence.cases) {
    throw new Error("calibration: invalid or duplicate per-case evidence");
  }
  const facts = evidence.caseFacts;
  const failedIds = facts.filter(f => f.failed).map(f => f.caseId).sort();
  const matchedResolvable = facts.filter(f => f.decisionClass === "resolvable" && !f.failed).length;
  if (facts.filter(f => f.decisionClass === "resolvable").length !== evidence.resolvableLabeled ||
      matchedResolvable !== evidence.matchedResolvable ||
      facts.filter(f => f.failed && f.decisionClass !== "resolvable").length !== evidence.nonResolvableFailures ||
      JSON.stringify(failedIds) !== JSON.stringify([...evidence.failedCaseIds].sort()) ||
      canonicalCounts(failuresByFacts(facts)) !== canonicalCounts(evidence.failuresByClass) ||
      JSON.stringify(segmentsFromFacts(facts)) !== JSON.stringify(
        [...evidence.segments].sort((a, b) => a.dimension.localeCompare(b.dimension) || a.label.localeCompare(b.label)))) {
    throw new Error("calibration: per-case, class or segment metrics inconsistent");
  }
  if (!evidence.corpusGate ||
      !["passed", "failed", "blocked", "sample_missing"].includes(evidence.corpusGate.status) ||
      !Array.isArray(evidence.corpusGate.blockReasons) ||
      evidence.corpusGate.blockReasons.some(v => typeof v !== "string" || !v.trim()) ||
      new Set(evidence.corpusGate.blockReasons).size !== evidence.corpusGate.blockReasons.length ||
      (evidence.corpusGate.status === "passed" && evidence.corpusGate.blockReasons.length > 0)) {
    throw new Error("calibration: missing or contradictory corpus gate");
  }
}

function comparable(baseline: SplitEvidence, trial: SplitEvidence): string[] {
  const reasons: string[] = [];
  const sampleOf = (evidence: SplitEvidence): string => JSON.stringify(evidence.caseFacts.map(fact => ({
    caseId: fact.caseId, decisionClass: fact.decisionClass, modality: fact.modality,
    brand: fact.brand, measure: fact.measure,
    nonRecurrenceClasses: [...fact.nonRecurrenceClasses].sort(),
  })).sort((a, b) => a.caseId.localeCompare(b.caseId)));
  if (sampleOf(baseline) !== sampleOf(trial)) reasons.push("case_universe_mismatch");
  if (baseline.cases !== trial.cases ||
      baseline.resolvableLabeled !== trial.resolvableLabeled ||
      baseline.segments.length !== trial.segments.length) reasons.push("sample_mismatch");
  if (trial.matchedResolvable < baseline.matchedResolvable) reasons.push("match_regression");
  if (trial.failedCaseIds.some(id => !baseline.failedCaseIds.includes(id))) reasons.push("case_regression");
  if (trial.nonResolvableFailures > baseline.nonResolvableFailures) reasons.push("false_acceptance_regression");
  if (trial.failedCases > baseline.failedCases) reasons.push("overall_regression");
  if (trial.abstentions > baseline.abstentions) reasons.push("abstention_regression");
  for (const segment of baseline.segments) {
    const candidate = trial.segments.find(s =>
      s.dimension === segment.dimension && s.label === segment.label);
    if (!candidate || candidate.cases !== segment.cases ||
        candidate.resolvableLabeled !== segment.resolvableLabeled) {
      reasons.push("segment_sample_mismatch:" + segment.dimension + ":" + segment.label);
    } else if (candidate.matchedResolvable < segment.matchedResolvable ||
        candidate.failedCases > segment.failedCases) {
      reasons.push("segment_regression:" + segment.dimension + ":" + segment.label);
    }
  }
  return reasons;
}

export type CalibrationLock = {
  status: "locked_for_holdout";
  planId: string;
  selectedCandidateId: string;
  lockedAt: string;
  calibrationDigest: string;
  calibrationComparison: readonly { candidateId: string; reasons: readonly string[]; matchedResolvable: number }[];
};
export type CalibrationSelection =
  | CalibrationLock
  | { status: "blocked"; reasons: readonly string[]; comparisons: readonly { candidateId: string; reasons: readonly string[] }[] };

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Candidate selection sees calibration evidence exclusively, never holdout. */
export function selectCalibrationCandidate(
  plan: CalibrationPlan,
  baseline: SplitEvidence,
  candidates: readonly SplitEvidence[],
  lockedAt: string,
): CalibrationSelection {
  verifyCalibrationPlan(plan);
  assertEvidence(plan, plan.baseline, baseline, "calibration");
  if (candidates.length !== plan.candidates.length) throw new Error("calibration: candidate trial missing");
  const lockTime = validDate(lockedAt);
  const all = [baseline, ...candidates];
  if (new Set(all.map(v => v.runId)).size !== all.length ||
      all.some(v => validDate(v.recordedAt) >= lockTime)) {
    throw new Error("calibration: repeated run or lock predating measurement");
  }
  const comparisons = plan.candidates.map(candidate => {
    const evidence = candidates.find(c => c.candidateId === candidate.id);
    if (!evidence) throw new Error("calibration: candidate not measured");
    assertEvidence(plan, candidate, evidence, "calibration");
    const reasons = comparable(baseline, evidence);
    if (plan.parameter === "linguistic:s3-escalation" &&
        (baseline.costSamples !== baseline.cases || evidence.costSamples !== evidence.cases ||
         baseline.totalCostUsd === null || evidence.totalCostUsd === null ||
         evidence.totalCostUsd >= baseline.totalCostUsd)) {
      reasons.push("s3_cost_reduction_not_demonstrated");
    }
    return { candidateId: candidate.id, reasons, matchedResolvable: evidence.matchedResolvable, matchedCases: evidence.matchedCases,
      costUsd: evidence.costSamples === evidence.cases ? evidence.totalCostUsd : null };
  });
  const feasible = comparisons.filter(item => !item.reasons.length);
  if (!feasible.length) return {
    status: "blocked", reasons: ["no_calibration_candidate_without_regression"],
    comparisons: comparisons.map(c => ({ candidateId: c.candidateId, reasons: c.reasons })),
  };
  // Strictly pre-registered ranking: correctness first; comparable cost next;
  // candidate order is the last tie break. No holdout signal reaches this path.
  feasible.sort((a, b) => b.matchedResolvable - a.matchedResolvable ||
    b.matchedCases - a.matchedCases ||
    (a.costUsd !== null && b.costUsd !== null ? a.costUsd - b.costUsd : 0) ||
    plan.candidates.findIndex(v => v.id === a.candidateId) -
    plan.candidates.findIndex(v => v.id === b.candidateId));
  return {
    status: "locked_for_holdout", planId: plan.id,
    selectedCandidateId: feasible[0].candidateId, lockedAt,
    // The global gate may reflect holdout outcomes and is intentionally not
    // used to rank candidates or to bind the pre-holdout selection.
    calibrationDigest: digest({ plan,
      baseline: { ...baseline, corpusGate: null },
      candidates: candidates.map(item => ({ ...item, corpusGate: null })), lockedAt }),
    calibrationComparison: comparisons.map(c => ({
      candidateId: c.candidateId, reasons: c.reasons,
      matchedResolvable: c.matchedResolvable,
    })),
  };
}

/** The exact calibration measurements must accompany the holdout package to
 * rederive the lock. A syntactically valid digest alone is not authentication. */
export interface CalibrationLockProof {
  baseline: SplitEvidence;
  candidates: readonly SplitEvidence[];
}
export interface HoldoutResult {
  status: "rejected" | "awaiting_independent_approval";
  reasons: readonly string[];
  item: number;
  candidateId: string;
  /** No automated parameter promotion is permitted. */
  approved: false;
  evidenceDigest: string;
}
export function evaluateLockedHoldout(
  plan: CalibrationPlan, lock: CalibrationLock,
  baseline: SplitEvidence, selected: SplitEvidence,
  proof: CalibrationLockProof,
): HoldoutResult {
  verifyCalibrationPlan(plan);
  const rederived = selectCalibrationCandidate(plan, proof.baseline, proof.candidates, lock.lockedAt);
  if (rederived.status !== "locked_for_holdout" ||
      rederived.calibrationDigest !== lock.calibrationDigest ||
      rederived.selectedCandidateId !== lock.selectedCandidateId) {
    throw new Error("calibration: selection lock has no matching calibration proof");
  }
  const candidate = plan.candidates.find(c => c.id === lock.selectedCandidateId);
  if (!candidate || lock.planId !== plan.id ||
      !/^[0-9a-f]{64}$/.test(lock.calibrationDigest) ||
      !lock.calibrationComparison.some(item =>
        item.candidateId === lock.selectedCandidateId && item.reasons.length === 0)) {
    throw new Error("calibration: invalid frozen selection");
  }
  assertEvidence(plan, plan.baseline, baseline, "holdout");
  assertEvidence(plan, candidate, selected, "holdout");
  if (baseline.runId === selected.runId ||
      [baseline, selected].some(e => validDate(e.recordedAt) <= validDate(lock.lockedAt))) {
    throw new Error("calibration: holdout exposed before selection lock");
  }
  const reasons = comparable(baseline, selected);
  // A Golden report can carry independent blockers (e.g. wrong macro
  // tolerance, metamorphic failures) even with 100% per-case counters.
  // Fail closed at approval, never use the global gate while tuning.
  for (const [role, evidence] of [
    ["calibration_baseline", proof.baseline],
    ...proof.candidates.map((item): [string, SplitEvidence] => ["calibration_candidate:" + item.candidateId, item]),
    ["holdout_baseline", baseline], ["holdout_candidate", selected],
  ] as [string, SplitEvidence][]) {
    if (evidence.corpusGate.status !== "passed") {
      reasons.push(role + ":corpus_gate_" + evidence.corpusGate.status);
      reasons.push(...evidence.corpusGate.blockReasons.map(reason => role + ":" + reason));
    }
  }
  if (selected.matchedResolvable / selected.resolvableLabeled < GOLDEN_CORPUS_MIN_MATCH_RATE) {
    reasons.push("minimum_95_percent_not_met");
  }
  if (selected.failedCases !== 0 || selected.nonResolvableFailures !== 0) {
    reasons.push("golden_corpus_or_negative_regression");
  }
  if (selected.abstentions !== 0) reasons.push("unexpected_abstention");
  return {
    status: reasons.length ? "rejected" : "awaiting_independent_approval",
    reasons, item: CALIBRATION_PARAMETERS[plan.parameter].item,
    candidateId: selected.candidateId, approved: false,
    evidenceDigest: digest({ lock, baseline, selected }),
  };
}
