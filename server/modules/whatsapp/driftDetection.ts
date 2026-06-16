import type { WhatsappPromotionPlan } from "./gradualPromotion";
import type { WhatsappIntentName } from "./intentSchema";
import type { WhatsappMessageHistoryInputType } from "./messageHistory";

export const WHATSAPP_DRIFT_DETECTION_VERSION = "whatsapp-drift-detection/v1";

export type WhatsappDriftMetricName =
  | "low_confidence_rate"
  | "fallback_rate"
  | "ambiguity_rate"
  | "later_correction_rate"
  | "brand_recognition_rate"
  | "product_recognition_rate"
  | "quantity_recognition_rate"
  | "relative_date_success_rate"
  | "action_accuracy_rate"
  | "intent_accuracy"
  | "persistence_error_rate";

export type WhatsappDriftSeverity = "info" | "watch" | "review" | "critical";
export type WhatsappDriftDecision = "stable" | "watch" | "review" | "block_promotion" | "rollback_review";
export type WhatsappDriftAction = "none" | "alert" | "send_to_review" | "block_promotion" | "review_rollback";
export type WhatsappDriftConversationMode = "single_turn" | "multi_turn" | "multiple_actions";

export type WhatsappDriftVersionContext = {
  promptVersion: string;
  schemaVersion: string;
  modelName: string;
  ruleVersion: string;
  nutritionSourceVersion?: string;
  classifierVersion?: string;
};

export type WhatsappDriftMetricSet = Partial<Record<WhatsappDriftMetricName, number>>;

export type WhatsappDriftSnapshot = {
  id: string;
  period: { from: string; to: string };
  sampleSize: number;
  intent: WhatsappIntentName | "unknown";
  inputType: WhatsappMessageHistoryInputType;
  conversationMode: WhatsappDriftConversationMode;
  versions: WhatsappDriftVersionContext;
  metrics: WhatsappDriftMetricSet;
};

export type WhatsappDriftFinding = {
  id: string;
  severity: WhatsappDriftSeverity;
  action: WhatsappDriftAction;
  metric: WhatsappDriftMetricName;
  before: number;
  after: number;
  delta: number;
  threshold: number;
  segment: {
    intent: WhatsappDriftSnapshot["intent"];
    inputType: WhatsappDriftSnapshot["inputType"];
    conversationMode: WhatsappDriftConversationMode;
  };
  versions: { baseline: WhatsappDriftVersionContext; current: WhatsappDriftVersionContext };
  reason: string;
};

export type WhatsappDriftAnalysis = {
  id: number;
  createdAt: string;
  decision: WhatsappDriftDecision;
  baselinePeriod: WhatsappDriftSnapshot["period"] | null;
  currentPeriod: WhatsappDriftSnapshot["period"] | null;
  findings: WhatsappDriftFinding[];
  affectedVersions: WhatsappDriftVersionContext[];
  promotionImpact: {
    planId: number;
    stage: WhatsappPromotionPlan["stage"];
    candidateVersion: string;
    action: Extract<WhatsappDriftAction, "none" | "block_promotion" | "review_rollback" | "send_to_review">;
    reason: string;
  } | null;
  policyVersion: typeof WHATSAPP_DRIFT_DETECTION_VERSION;
  integrations: typeof WHATSAPP_DRIFT_DETECTION_POLICY.integrations;
};

type DriftInput = {
  baseline: WhatsappDriftSnapshot[];
  current: WhatsappDriftSnapshot[];
  promotionPlan?: Pick<WhatsappPromotionPlan, "id" | "stage" | "candidate"> | null;
  createdAt?: Date;
};

type DriftRule = {
  direction: "increase" | "decrease";
  watch: number;
  review: number;
  critical: number;
};

const analyses: WhatsappDriftAnalysis[] = [];
let nextAnalysisId = 1;

export const WHATSAPP_DRIFT_DETECTION_POLICY = {
  minimumSampleSize: 20,
  segmentKeys: ["intent", "inputType", "conversationMode"] as const,
  metrics: {
    low_confidence_rate: { direction: "increase", watch: 0.04, review: 0.08, critical: 0.14 },
    fallback_rate: { direction: "increase", watch: 0.03, review: 0.07, critical: 0.12 },
    ambiguity_rate: { direction: "increase", watch: 0.04, review: 0.08, critical: 0.14 },
    later_correction_rate: { direction: "increase", watch: 0.02, review: 0.04, critical: 0.08 },
    brand_recognition_rate: { direction: "decrease", watch: 0.06, review: 0.1, critical: 0.18 },
    product_recognition_rate: { direction: "decrease", watch: 0.06, review: 0.1, critical: 0.18 },
    quantity_recognition_rate: { direction: "decrease", watch: 0.05, review: 0.09, critical: 0.16 },
    relative_date_success_rate: { direction: "decrease", watch: 0.05, review: 0.09, critical: 0.16 },
    action_accuracy_rate: { direction: "decrease", watch: 0.04, review: 0.08, critical: 0.14 },
    intent_accuracy: { direction: "decrease", watch: 0.03, review: 0.06, critical: 0.1 },
    persistence_error_rate: { direction: "increase", watch: 0.005, review: 0.01, critical: 0.02 },
  } satisfies Record<WhatsappDriftMetricName, DriftRule>,
  promotionBlockingMetrics: ["persistence_error_rate", "later_correction_rate", "fallback_rate", "low_confidence_rate", "intent_accuracy", "action_accuracy_rate"] satisfies WhatsappDriftMetricName[],
  integrations: {
    metrics: "#417",
    reprocessing: "#416",
    multiTurnRegression: "#428",
    orchestration: "#429",
    promotion: "#431",
  },
  version: WHATSAPP_DRIFT_DETECTION_VERSION,
} as const;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function clampRate(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function segmentKey(snapshot: Pick<WhatsappDriftSnapshot, "intent" | "inputType" | "conversationMode">) {
  return `${snapshot.intent}|${snapshot.inputType}|${snapshot.conversationMode}`;
}

function versionKey(version: WhatsappDriftVersionContext) {
  return [version.promptVersion, version.schemaVersion, version.modelName, version.ruleVersion, version.nutritionSourceVersion ?? "", version.classifierVersion ?? ""].join("|");
}

function periodFrom(snapshots: WhatsappDriftSnapshot[]) {
  if (snapshots.length === 0) return null;
  return {
    from: snapshots.map(snapshot => snapshot.period.from).sort()[0],
    to: snapshots.map(snapshot => snapshot.period.to).sort().at(-1) ?? snapshots[0].period.to,
  };
}

function severityFor(delta: number, rule: DriftRule): WhatsappDriftSeverity | null {
  if (delta >= rule.critical) return "critical";
  if (delta >= rule.review) return "review";
  if (delta >= rule.watch) return "watch";
  return null;
}

function actionFor(severity: WhatsappDriftSeverity, metric: WhatsappDriftMetricName, hasPromotion: boolean): WhatsappDriftAction {
  const promotionBlockingMetrics = WHATSAPP_DRIFT_DETECTION_POLICY.promotionBlockingMetrics as readonly WhatsappDriftMetricName[];
  if (severity === "critical" && hasPromotion && promotionBlockingMetrics.includes(metric)) return "block_promotion";
  if (severity === "critical") return "send_to_review";
  if (severity === "review") return "send_to_review";
  if (severity === "watch") return "alert";
  return "none";
}

function worseningDelta(rule: DriftRule, before: number, after: number) {
  return clampRate(rule.direction === "increase" ? after - before : before - after);
}

function reasonFor(metric: WhatsappDriftMetricName, severity: WhatsappDriftSeverity, delta: number, snapshot: WhatsappDriftSnapshot) {
  const base = `${metric} apresentou drift ${severity} de ${delta} no segmento ${snapshot.intent}/${snapshot.inputType}/${snapshot.conversationMode}.`;
  if (severity === "critical") return `${base} Bloquear promocao ou revisar rollback antes de ampliar a versao.`;
  if (severity === "review") return `${base} Enviar para revisao antes de promover nova regra, prompt ou modelo.`;
  return `${base} Acompanhar tendencia no proximo periodo.`;
}

function compareSnapshotPair(baseline: WhatsappDriftSnapshot, current: WhatsappDriftSnapshot, hasPromotion: boolean) {
  const findings: WhatsappDriftFinding[] = [];
  if (baseline.sampleSize < WHATSAPP_DRIFT_DETECTION_POLICY.minimumSampleSize || current.sampleSize < WHATSAPP_DRIFT_DETECTION_POLICY.minimumSampleSize) {
    return findings;
  }
  for (const [metric, rule] of Object.entries(WHATSAPP_DRIFT_DETECTION_POLICY.metrics)) {
    const metricName = metric as WhatsappDriftMetricName;
    const before = baseline.metrics[metricName];
    const after = current.metrics[metricName];
    if (before === undefined || after === undefined) continue;
    const delta = worseningDelta(rule, before, after);
    const severity = severityFor(delta, rule);
    if (!severity) continue;
    findings.push({
      id: `${segmentKey(current)}:${metricName}`,
      severity,
      action: actionFor(severity, metricName, hasPromotion),
      metric: metricName,
      before: clampRate(before),
      after: clampRate(after),
      delta,
      threshold: rule[severity === "critical" ? "critical" : severity === "review" ? "review" : "watch"],
      segment: { intent: current.intent, inputType: current.inputType, conversationMode: current.conversationMode },
      versions: { baseline: baseline.versions, current: current.versions },
      reason: reasonFor(metricName, severity, delta, current),
    });
  }
  return findings;
}

function decisionFrom(findings: WhatsappDriftFinding[], plan?: Pick<WhatsappPromotionPlan, "stage"> | null): WhatsappDriftDecision {
  const hasCritical = findings.some(finding => finding.severity === "critical");
  const blocksPromotion = findings.some(finding => finding.action === "block_promotion");
  if (hasCritical && plan && (plan.stage === "broad" || plan.stage === "canary")) return "rollback_review";
  if (blocksPromotion) return "block_promotion";
  if (findings.some(finding => finding.severity === "review" || finding.severity === "critical")) return "review";
  if (findings.some(finding => finding.severity === "watch")) return "watch";
  return "stable";
}

function promotionImpactFor(decision: WhatsappDriftDecision, plan?: Pick<WhatsappPromotionPlan, "id" | "stage" | "candidate"> | null): WhatsappDriftAnalysis["promotionImpact"] {
  if (!plan) return null;
  if (decision === "rollback_review") {
    return { planId: plan.id, stage: plan.stage, candidateVersion: plan.candidate.candidateVersion, action: "review_rollback", reason: "Drift critico em versao ativa exige revisao de rollback antes de ampliar ou manter promocao." };
  }
  if (decision === "block_promotion") {
    return { planId: plan.id, stage: plan.stage, candidateVersion: plan.candidate.candidateVersion, action: "block_promotion", reason: "Drift critico bloqueia promocao da candidata ate revisao." };
  }
  if (decision === "review") {
    return { planId: plan.id, stage: plan.stage, candidateVersion: plan.candidate.candidateVersion, action: "send_to_review", reason: "Drift relevante exige revisao antes de nova promocao." };
  }
  return { planId: plan.id, stage: plan.stage, candidateVersion: plan.candidate.candidateVersion, action: "none", reason: "Nenhum drift relevante bloqueia a promocao." };
}

function affectedVersions(findings: WhatsappDriftFinding[]) {
  const seen = new Set<string>();
  const versions: WhatsappDriftVersionContext[] = [];
  for (const finding of findings) {
    const key = versionKey(finding.versions.current);
    if (seen.has(key)) continue;
    seen.add(key);
    versions.push(finding.versions.current);
  }
  return versions;
}

export function analyzeWhatsappAiDrift(input: DriftInput): WhatsappDriftAnalysis {
  const baselineBySegment = new Map(input.baseline.map(snapshot => [segmentKey(snapshot), snapshot]));
  const findings = input.current.flatMap(current => {
    const baseline = baselineBySegment.get(segmentKey(current));
    return baseline ? compareSnapshotPair(baseline, current, Boolean(input.promotionPlan)) : [];
  });
  const decision = decisionFrom(findings, input.promotionPlan);
  const analysis: WhatsappDriftAnalysis = {
    id: nextAnalysisId,
    createdAt: toIso(input.createdAt),
    decision,
    baselinePeriod: periodFrom(input.baseline),
    currentPeriod: periodFrom(input.current),
    findings,
    affectedVersions: affectedVersions(findings),
    promotionImpact: promotionImpactFor(decision, input.promotionPlan),
    policyVersion: WHATSAPP_DRIFT_DETECTION_VERSION,
    integrations: WHATSAPP_DRIFT_DETECTION_POLICY.integrations,
  };
  nextAnalysisId += 1;
  analyses.push(analysis);
  return analysis;
}

export function listWhatsappDriftAnalyses(filter: Partial<Pick<WhatsappDriftAnalysis, "decision">> = {}) {
  return analyses.filter(analysis => {
    if (filter.decision && analysis.decision !== filter.decision) return false;
    return true;
  });
}

export function __resetWhatsappDriftDetectionForTests() {
  analyses.length = 0;
  nextAnalysisId = 1;
}
