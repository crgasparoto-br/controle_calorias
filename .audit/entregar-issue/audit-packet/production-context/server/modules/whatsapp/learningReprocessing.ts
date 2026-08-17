import type { WhatsappIntentName } from "./intentSchema";

export const WHATSAPP_LEARNING_REPROCESSING_VERSION = "whatsapp-learning-reprocessing/v1";

export type WhatsappReprocessingDecision = "approve" | "review" | "reject" | "shadow";
export type WhatsappReprocessingDifferenceType =
  | "intent_changed"
  | "action_changed"
  | "persistence_changed"
  | "entity_changed"
  | "confidence_changed"
  | "calibrated_confidence_changed"
  | "regression"
  | "improvement";

export type WhatsappReprocessingOutput = {
  intent: WhatsappIntentName | "unknown";
  action: string;
  persisted: boolean;
  confidence: number;
  calibratedConfidence: number | null;
  entities: Record<string, unknown>;
  blocked: boolean;
  needsClarification: boolean;
  quality: "pass" | "fail" | "unknown";
};

export type WhatsappValidatedExample = {
  id: string;
  input: string;
  expectedIntent: WhatsappIntentName | "unknown";
  expectedAction: string;
  expectedPersisted: boolean;
  source: "regression_dataset" | "review_queue" | "support" | "golden" | "manual";
  isGolden: boolean;
  requiresReview?: boolean;
  previousVersion: string;
  previousOutput: WhatsappReprocessingOutput;
};

export type WhatsappReprocessedExampleResult = {
  exampleId: string;
  input: string;
  source: WhatsappValidatedExample["source"];
  isGolden: boolean;
  oldVersion: string;
  newVersion: string;
  previousOutput: WhatsappReprocessingOutput;
  newOutput: WhatsappReprocessingOutput;
  differences: Array<{ type: WhatsappReprocessingDifferenceType; field: string; before: unknown; after: unknown; impact: "low" | "medium" | "high" | "blocking" }>;
  changed: boolean;
  regression: boolean;
  improvement: boolean;
  highImpact: boolean;
  reason: string;
  decision: WhatsappReprocessingDecision;
};

export type WhatsappReprocessingRun = {
  id: number;
  createdAt: string;
  candidateName: string;
  oldVersion: string;
  newVersion: string;
  reason: string;
  examplesTotal: number;
  changedCount: number;
  regressionCount: number;
  improvementCount: number;
  highImpactCount: number;
  reviewRequired: boolean;
  decision: WhatsappReprocessingDecision;
  impactByIntent: Record<string, { total: number; changed: number; regressions: number; improvements: number; highImpact: number }>;
  results: WhatsappReprocessedExampleResult[];
  policyVersion: typeof WHATSAPP_LEARNING_REPROCESSING_VERSION;
};

type ReprocessInput = {
  candidateName: string;
  oldVersion: string;
  newVersion: string;
  reason: string;
  examples: WhatsappValidatedExample[];
  runExample: (example: WhatsappValidatedExample) => WhatsappReprocessingOutput;
  createdAt?: Date;
};

const runs: WhatsappReprocessingRun[] = [];
let nextRunId = 1;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function addDifference(
  differences: WhatsappReprocessedExampleResult["differences"],
  type: WhatsappReprocessingDifferenceType,
  field: string,
  before: unknown,
  after: unknown,
  impact: "low" | "medium" | "high" | "blocking",
) {
  differences.push({ type, field, before, after, impact });
}

function compareOutputs(example: WhatsappValidatedExample, newOutput: WhatsappReprocessingOutput) {
  const previous = example.previousOutput;
  const differences: WhatsappReprocessedExampleResult["differences"] = [];

  if (previous.intent !== newOutput.intent) addDifference(differences, "intent_changed", "intent", previous.intent, newOutput.intent, "blocking");
  if (previous.action !== newOutput.action) addDifference(differences, "action_changed", "action", previous.action, newOutput.action, "high");
  if (previous.persisted !== newOutput.persisted) addDifference(differences, "persistence_changed", "persisted", previous.persisted, newOutput.persisted, "blocking");
  if (!sameJson(previous.entities, newOutput.entities)) addDifference(differences, "entity_changed", "entities", previous.entities, newOutput.entities, "medium");

  const confidenceDelta = Number((newOutput.confidence - previous.confidence).toFixed(2));
  if (Math.abs(confidenceDelta) >= 0.15) addDifference(differences, "confidence_changed", "confidence", previous.confidence, newOutput.confidence, Math.abs(confidenceDelta) >= 0.3 ? "high" : "medium");

  if (previous.calibratedConfidence !== null && newOutput.calibratedConfidence !== null) {
    const calibratedDelta = Number((newOutput.calibratedConfidence - previous.calibratedConfidence).toFixed(2));
    if (Math.abs(calibratedDelta) >= 0.15) addDifference(differences, "calibrated_confidence_changed", "calibratedConfidence", previous.calibratedConfidence, newOutput.calibratedConfidence, Math.abs(calibratedDelta) >= 0.3 ? "high" : "medium");
  }

  const wasCorrect = previous.intent === example.expectedIntent && previous.action === example.expectedAction && previous.persisted === example.expectedPersisted && previous.quality === "pass";
  const nowCorrect = newOutput.intent === example.expectedIntent && newOutput.action === example.expectedAction && newOutput.persisted === example.expectedPersisted && newOutput.quality === "pass";
  if (wasCorrect && !nowCorrect) addDifference(differences, "regression", "quality", "pass", newOutput.quality, "blocking");
  if (!wasCorrect && nowCorrect) addDifference(differences, "improvement", "quality", previous.quality, "pass", "low");

  return differences;
}

function decisionForResult(example: WhatsappValidatedExample, differences: WhatsappReprocessedExampleResult["differences"]): WhatsappReprocessingDecision {
  if (differences.some(diff => diff.type === "regression" || diff.impact === "blocking")) return "reject";
  if (example.requiresReview || differences.some(diff => diff.impact === "high")) return "review";
  if (differences.length > 0) return "shadow";
  return "approve";
}

function reasonForResult(result: Omit<WhatsappReprocessedExampleResult, "reason">) {
  if (result.regression) return "Regressao detectada em exemplo validado.";
  if (result.highImpact) return "Mudanca de alto impacto exige revisao antes da promocao.";
  if (result.improvement) return "Mudanca melhora exemplo anteriormente falho.";
  if (result.changed) return "Mudanca estrutural deve permanecer em sombra para observacao.";
  return "Sem diferenca relevante entre versoes.";
}

function summarizeDecision(results: WhatsappReprocessedExampleResult[]): { decision: WhatsappReprocessingDecision; reviewRequired: boolean } {
  if (results.some(result => result.regression)) return { decision: "reject", reviewRequired: true };
  if (results.some(result => result.highImpact || result.decision === "review")) return { decision: "review", reviewRequired: true };
  if (results.some(result => result.changed)) return { decision: "shadow", reviewRequired: false };
  return { decision: "approve", reviewRequired: false };
}

function addImpact(summary: WhatsappReprocessingRun["impactByIntent"], result: WhatsappReprocessedExampleResult) {
  const key = result.previousOutput.intent;
  const current = summary[key] ?? { total: 0, changed: 0, regressions: 0, improvements: 0, highImpact: 0 };
  current.total += 1;
  current.changed += result.changed ? 1 : 0;
  current.regressions += result.regression ? 1 : 0;
  current.improvements += result.improvement ? 1 : 0;
  current.highImpact += result.highImpact ? 1 : 0;
  summary[key] = current;
}

export function reprocessWhatsappValidatedExamples(input: ReprocessInput): WhatsappReprocessingRun {
  const createdAt = toIso(input.createdAt);
  const results = input.examples.map(example => {
    const newOutput = {
      ...input.runExample(example),
      confidence: clamp(input.runExample(example).confidence),
      calibratedConfidence: input.runExample(example).calibratedConfidence === null ? null : clamp(input.runExample(example).calibratedConfidence ?? 0),
    };
    const differences = compareOutputs(example, newOutput);
    const base = {
      exampleId: example.id,
      input: example.input,
      source: example.source,
      isGolden: example.isGolden,
      oldVersion: input.oldVersion || example.previousVersion,
      newVersion: input.newVersion,
      previousOutput: example.previousOutput,
      newOutput,
      differences,
      changed: differences.length > 0,
      regression: differences.some(diff => diff.type === "regression"),
      improvement: differences.some(diff => diff.type === "improvement"),
      highImpact: differences.some(diff => diff.impact === "high" || diff.impact === "blocking"),
      decision: "approve" as WhatsappReprocessingDecision,
    };
    const decision = decisionForResult(example, differences);
    return { ...base, decision, reason: reasonForResult({ ...base, decision }) };
  });
  const impactByIntent: WhatsappReprocessingRun["impactByIntent"] = {};
  for (const result of results) addImpact(impactByIntent, result);
  const summaryDecision = summarizeDecision(results);
  const run: WhatsappReprocessingRun = {
    id: nextRunId,
    createdAt,
    candidateName: input.candidateName,
    oldVersion: input.oldVersion,
    newVersion: input.newVersion,
    reason: input.reason,
    examplesTotal: results.length,
    changedCount: results.filter(result => result.changed).length,
    regressionCount: results.filter(result => result.regression).length,
    improvementCount: results.filter(result => result.improvement).length,
    highImpactCount: results.filter(result => result.highImpact).length,
    reviewRequired: summaryDecision.reviewRequired,
    decision: summaryDecision.decision,
    impactByIntent,
    results,
    policyVersion: WHATSAPP_LEARNING_REPROCESSING_VERSION,
  };
  nextRunId += 1;
  runs.push(run);
  return run;
}

export function listWhatsappReprocessingRuns() {
  return [...runs];
}

export function __resetWhatsappLearningReprocessingForTests() {
  runs.length = 0;
  nextRunId = 1;
}
