import type { WhatsappIntentName } from "./intentSchema";
import type { WhatsappLearningSignalAssessment } from "./learningSecurity";
import type { WhatsappMessageHistoryInputType } from "./messageHistory";
import type { WhatsappQualityMetricName } from "./qualityGates";

export const WHATSAPP_SELF_IMPROVEMENT_PLANNER_VERSION = "whatsapp-self-improvement-planner/v1";

export type WhatsappImprovementSignalKind =
  | "low_confidence"
  | "later_correction"
  | "negative_feedback"
  | "fallback"
  | "ambiguity"
  | "nutrition_divergence"
  | "drift"
  | "cost"
  | "latency"
  | "operational_failure"
  | "false_positive_food";
export type WhatsappImprovementBacklogKind =
  | "individual_memory"
  | "global_candidate"
  | "global_rule"
  | "nutrition_curation"
  | "regression_test"
  | "prompt_or_model_change"
  | "operational_change"
  | "confidence_calibration"
  | "rollback_review";
export type WhatsappImprovementBacklogStatus = "suggested" | "needs_review" | "quarantined" | "blocked";
export type WhatsappImprovementRisk = "low" | "medium" | "high" | "critical";
export type WhatsappImprovementEffort = "small" | "medium" | "large";
export type WhatsappImprovementDatasetTarget = "positive" | "negative" | "ambiguous" | "multi_turn";

export type WhatsappImprovementSignal = {
  id: string;
  createdAt: string;
  kind: WhatsappImprovementSignalKind;
  intent: WhatsappIntentName | "unknown";
  inputType: WhatsappMessageHistoryInputType;
  pipelineStage: "classification" | "entity_extraction" | "nutrition_source" | "calibration" | "safety" | "tool_execution" | "response";
  version: string;
  userHash?: string | null;
  foodName?: string | null;
  brand?: string | null;
  category?: string | null;
  rule?: string | null;
  prompt?: string | null;
  nutritionSource?: string | null;
  metric: WhatsappQualityMetricName;
  metricValue: number;
  impact: number;
  confidence: number;
  estimatedEffort?: WhatsappImprovementEffort;
  evidenceSummary: string;
  suspectedDataPoisoning?: boolean;
  securityAssessment?: Pick<WhatsappLearningSignalAssessment, "classification" | "state" | "riskSignals" | "reasons"> | null;
};

export type WhatsappImprovementBacklogItem = {
  id: string;
  title: string;
  kind: WhatsappImprovementBacklogKind;
  status: WhatsappImprovementBacklogStatus;
  groupKey: string;
  intent: WhatsappIntentName | "unknown";
  inputType: WhatsappMessageHistoryInputType;
  scope: "individual" | "global" | "system";
  priorityScore: number;
  frequency: number;
  impactScore: number;
  confidenceScore: number;
  risk: WhatsappImprovementRisk;
  effort: WhatsappImprovementEffort;
  expectedMetric: WhatsappQualityMetricName;
  expectedImprovement: string;
  rationale: string;
  evidence: Array<{ signalId: string; source: WhatsappImprovementSignalKind; summary: string; version: string }>;
  suggestedDatasetCases: Array<{ target: WhatsappImprovementDatasetTarget; reason: string; sourceSignalId: string }>;
  dependencies: string[];
  requiredTests: string[];
  directPromotionAllowed: false;
  governanceRequired: boolean;
  qualityGatesRequired: boolean;
  securityReviewRequired: boolean;
  policyVersion: typeof WHATSAPP_SELF_IMPROVEMENT_PLANNER_VERSION;
};

export type WhatsappImprovementPlan = {
  id: number;
  createdAt: string;
  inputSignals: number;
  backlog: WhatsappImprovementBacklogItem[];
  blockedSignals: number;
  audit: {
    policyVersion: typeof WHATSAPP_SELF_IMPROVEMENT_PLANNER_VERSION;
    integrations: typeof WHATSAPP_SELF_IMPROVEMENT_PLANNER_POLICY.integrations;
    groupingDimensions: typeof WHATSAPP_SELF_IMPROVEMENT_PLANNER_POLICY.groupingDimensions;
    generatedBehaviorChanges: false;
  };
};

type PlanInput = {
  signals: WhatsappImprovementSignal[];
  createdAt?: Date;
};

const plans: WhatsappImprovementPlan[] = [];
let nextPlanId = 1;

const effortWeight: Record<WhatsappImprovementEffort, number> = { small: 1, medium: 1.4, large: 2 };
const riskWeight: Record<WhatsappImprovementRisk, number> = { low: 1, medium: 0.9, high: 0.75, critical: 0.5 };

export const WHATSAPP_SELF_IMPROVEMENT_PLANNER_POLICY = {
  minEvidenceSignals: 1,
  groupingDimensions: ["intent", "inputType", "foodName", "brand", "category", "rule", "prompt", "nutritionSource", "version", "pipelineStage"],
  promotion: "Nenhuma sugestao altera comportamento ativo; itens seguem para revisao, governanca, quality gates, replay e promocao gradual.",
  integrations: {
    reviewQueue: "#414",
    metrics: "#417",
    feedbackLoop: "#430",
    drift: "#431",
    knowledgeValidity: "#434",
    explainability: "#435",
    negativeEvaluation: "#441",
    governance: "#443",
    security: "#444",
    confidenceCalibration: "#445",
    qualityGates: "#446",
  },
  version: WHATSAPP_SELF_IMPROVEMENT_PLANNER_VERSION,
} as const;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function normalize(value: string | null | undefined) {
  return (value ?? "*").toLowerCase().trim().replace(/\s+/g, " ");
}

function groupKey(signal: WhatsappImprovementSignal) {
  const entity = normalize(signal.foodName ?? signal.brand ?? signal.category ?? signal.rule ?? signal.prompt ?? signal.nutritionSource);
  return [signal.kind, signal.intent, signal.inputType, signal.pipelineStage, entity, signal.version].join("|");
}

function riskFor(signals: WhatsappImprovementSignal[]): WhatsappImprovementRisk {
  if (signals.some(signal => signal.suspectedDataPoisoning || signal.securityAssessment?.classification === "blocked")) return "critical";
  if (signals.some(signal => signal.kind === "false_positive_food" || (signal.kind === "nutrition_divergence" && signal.impact >= 0.8))) return "high";
  if (signals.some(signal => signal.kind === "later_correction" || signal.kind === "negative_feedback" || signal.kind === "drift")) return "medium";
  return "low";
}

function effortFor(signals: WhatsappImprovementSignal[]): WhatsappImprovementEffort {
  if (signals.some(signal => signal.estimatedEffort === "large")) return "large";
  if (signals.some(signal => signal.estimatedEffort === "medium" || signal.kind === "drift" || signal.kind === "nutrition_divergence")) return "medium";
  return "small";
}

function kindFor(signals: WhatsappImprovementSignal[]): WhatsappImprovementBacklogKind {
  if (signals.some(signal => signal.suspectedDataPoisoning || signal.securityAssessment?.classification === "blocked" || signal.securityAssessment?.classification === "quarantined")) return "rollback_review";
  if (signals.some(signal => signal.kind === "false_positive_food")) return "regression_test";
  if (signals.some(signal => signal.kind === "nutrition_divergence")) return "nutrition_curation";
  if (signals.some(signal => signal.kind === "low_confidence")) return "confidence_calibration";
  if (signals.some(signal => signal.kind === "drift")) return "prompt_or_model_change";
  if (signals.some(signal => signal.kind === "cost" || signal.kind === "latency" || signal.kind === "operational_failure")) return "operational_change";
  if (signals.some(signal => signal.userHash) && new Set(signals.map(signal => signal.userHash).filter(Boolean)).size === 1) return "individual_memory";
  return "global_candidate";
}

function statusFor(kind: WhatsappImprovementBacklogKind, risk: WhatsappImprovementRisk, signals: WhatsappImprovementSignal[]): WhatsappImprovementBacklogStatus {
  if (signals.some(signal => signal.securityAssessment?.classification === "blocked" || signal.suspectedDataPoisoning)) return "blocked";
  if (signals.some(signal => signal.securityAssessment?.classification === "quarantined")) return "quarantined";
  if (risk === "high" || risk === "critical" || kind === "global_rule" || kind === "prompt_or_model_change" || kind === "rollback_review") return "needs_review";
  return "suggested";
}

function datasetCasesFor(signals: WhatsappImprovementSignal[]): WhatsappImprovementBacklogItem["suggestedDatasetCases"] {
  return signals.flatMap(signal => {
    if (signal.kind === "false_positive_food") return [{ target: "negative" as const, reason: "Falso positivo alimentar deve virar caso negativo de regressao.", sourceSignalId: signal.id }];
    if (signal.kind === "ambiguity") return [{ target: "ambiguous" as const, reason: "Ambiguidade recorrente deve virar fixture de esclarecimento.", sourceSignalId: signal.id }];
    if (signal.kind === "later_correction") return [{ target: "multi_turn" as const, reason: "Correcao posterior deve exercitar contexto entre turnos.", sourceSignalId: signal.id }];
    return [{ target: "positive" as const, reason: "Sinal recorrente deve compor dataset positivo ou comparativo.", sourceSignalId: signal.id }];
  });
}

function dependenciesFor(kind: WhatsappImprovementBacklogKind, risk: WhatsappImprovementRisk) {
  const base = ["#414", "#417", "#443", "#446"];
  if (kind === "nutrition_curation") base.push("#434");
  if (kind === "confidence_calibration") base.push("#445");
  if (kind === "regression_test") base.push("#441");
  if (risk === "high" || risk === "critical") base.push("#444");
  return [...new Set(base)];
}

function testsFor(kind: WhatsappImprovementBacklogKind, risk: WhatsappImprovementRisk) {
  const tests = ["offline_replay", "quality_gates"];
  if (kind === "regression_test") tests.push("negative_regression_dataset");
  if (kind === "nutrition_curation") tests.push("nutrition_source_validation");
  if (kind === "confidence_calibration") tests.push("confidence_calibration_segment");
  if (kind === "prompt_or_model_change") tests.push("shadow_mode", "canary_before_broad_promotion");
  if (risk === "high" || risk === "critical") tests.push("security_review", "governance_approval");
  return [...new Set(tests)];
}

function titleFor(kind: WhatsappImprovementBacklogKind, signals: WhatsappImprovementSignal[]) {
  const first = signals[0];
  const subject = first.foodName ?? first.brand ?? first.category ?? first.rule ?? first.prompt ?? first.nutritionSource ?? first.intent;
  const labels: Record<WhatsappImprovementBacklogKind, string> = {
    individual_memory: "Revisar memoria individual",
    global_candidate: "Investigar padrao recorrente",
    global_rule: "Propor regra global candidata",
    nutrition_curation: "Revisar curadoria nutricional",
    regression_test: "Adicionar caso de regressao",
    prompt_or_model_change: "Avaliar ajuste de prompt ou modelo",
    operational_change: "Investigar melhoria operacional",
    confidence_calibration: "Recalibrar confianca do segmento",
    rollback_review: "Revisar sinal suspeito antes de qualquer mudanca",
  };
  return `${labels[kind]}: ${subject}`;
}

function expectedMetricFor(kind: WhatsappImprovementBacklogKind, signals: WhatsappImprovementSignal[]): WhatsappQualityMetricName {
  if (kind === "regression_test") return "false_positive_food_rate";
  if (kind === "nutrition_curation") return "nutrition_divergence_rate";
  if (kind === "confidence_calibration") return "calibrated_low_confidence_rate";
  if (kind === "operational_change") return signals.some(signal => signal.kind === "latency") ? "p95_latency_ms" : "cost_per_message";
  return signals[0].metric;
}

function priorityFor(input: { frequency: number; impact: number; confidence: number; risk: WhatsappImprovementRisk; effort: WhatsappImprovementEffort }) {
  const raw = (input.frequency * input.impact * input.confidence * riskWeight[input.risk]) / effortWeight[input.effort];
  return Number(Math.min(100, raw * 25).toFixed(2));
}

function backlogItem(index: number, key: string, signals: WhatsappImprovementSignal[]): WhatsappImprovementBacklogItem {
  const risk = riskFor(signals);
  const effort = effortFor(signals);
  const kind = kindFor(signals);
  const status = statusFor(kind, risk, signals);
  const frequency = signals.length;
  const impactScore = clamp01(signals.reduce((sum, signal) => sum + signal.impact, 0) / frequency);
  const confidenceScore = clamp01(signals.reduce((sum, signal) => sum + signal.confidence, 0) / frequency);
  const expectedMetric = expectedMetricFor(kind, signals);
  const first = signals[0];

  return {
    id: `whatsapp-improvement-${index + 1}`,
    title: titleFor(kind, signals),
    kind,
    status,
    groupKey: key,
    intent: first.intent,
    inputType: first.inputType,
    scope: kind === "individual_memory" ? "individual" : kind === "operational_change" || kind === "confidence_calibration" ? "system" : "global",
    priorityScore: priorityFor({ frequency, impact: impactScore, confidence: confidenceScore, risk, effort }),
    frequency,
    impactScore,
    confidenceScore,
    risk,
    effort,
    expectedMetric,
    expectedImprovement: `Melhorar ${expectedMetric} sem violar governanca, seguranca ou quality gates.`,
    rationale: `Grupo recorrente com ${frequency} sinal(is), impacto medio ${impactScore} e confianca media ${confidenceScore}.`,
    evidence: signals.map(signal => ({ signalId: signal.id, source: signal.kind, summary: signal.evidenceSummary, version: signal.version })),
    suggestedDatasetCases: datasetCasesFor(signals),
    dependencies: dependenciesFor(kind, risk),
    requiredTests: testsFor(kind, risk),
    directPromotionAllowed: false,
    governanceRequired: status !== "suggested" || kind !== "individual_memory",
    qualityGatesRequired: true,
    securityReviewRequired: risk === "high" || risk === "critical" || status === "blocked" || status === "quarantined",
    policyVersion: WHATSAPP_SELF_IMPROVEMENT_PLANNER_VERSION,
  };
}

export function planWhatsappSelfImprovements(input: PlanInput): WhatsappImprovementPlan {
  const groups = new Map<string, WhatsappImprovementSignal[]>();
  for (const signal of input.signals) {
    const key = groupKey(signal);
    groups.set(key, [...(groups.get(key) ?? []), signal]);
  }

  const backlog = [...groups.entries()]
    .filter(([, signals]) => signals.length >= WHATSAPP_SELF_IMPROVEMENT_PLANNER_POLICY.minEvidenceSignals)
    .map(([key, signals], index) => backlogItem(index, key, signals))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title));

  const plan: WhatsappImprovementPlan = {
    id: nextPlanId,
    createdAt: toIso(input.createdAt),
    inputSignals: input.signals.length,
    backlog,
    blockedSignals: input.signals.filter(signal => signal.suspectedDataPoisoning || signal.securityAssessment?.classification === "blocked").length,
    audit: {
      policyVersion: WHATSAPP_SELF_IMPROVEMENT_PLANNER_VERSION,
      integrations: WHATSAPP_SELF_IMPROVEMENT_PLANNER_POLICY.integrations,
      groupingDimensions: WHATSAPP_SELF_IMPROVEMENT_PLANNER_POLICY.groupingDimensions,
      generatedBehaviorChanges: false,
    },
  };
  nextPlanId += 1;
  plans.push(plan);
  return plan;
}

export function listWhatsappSelfImprovementPlans() {
  return [...plans];
}

export function __resetWhatsappSelfImprovementPlannerForTests() {
  plans.length = 0;
  nextPlanId = 1;
}
