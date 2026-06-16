import {
  WHATSAPP_DRIFT_DETECTION_VERSION,
  type WhatsappDriftAnalysis,
} from "./driftDetection";
import {
  WHATSAPP_GRADUAL_PROMOTION_VERSION,
  type WhatsappPromotionPlan,
} from "./gradualPromotion";
import {
  WHATSAPP_LEARNING_GOVERNANCE_VERSION,
  type WhatsappLearningCandidate,
} from "./learningGovernance";
import {
  WHATSAPP_LEARNING_VERSIONING_VERSION,
  type WhatsappDecisionVersionSnapshot,
} from "./learningVersioning";
import {
  WHATSAPP_QUALITY_METRICS_VERSION,
  type WhatsappQualityMetricsReport,
} from "./qualityMetrics";
import type { WhatsappReviewQueueItem } from "./reviewQueue";

export const WHATSAPP_LEARNING_ENGINE_VERSION = "whatsapp-learning-engine/v1";

export type WhatsappLearningEngineComponentKey =
  | "privacy"
  | "messageHistory"
  | "feedback"
  | "reviewQueue"
  | "governance"
  | "versioning"
  | "reprocessing"
  | "qualityGates"
  | "gradualPromotion"
  | "driftDetection"
  | "qualityMetrics"
  | "observability"
  | "poisoningGuard";

export type WhatsappLearningEngineComponentStatus = "ready" | "missing" | "needs_review" | "blocked";
export type WhatsappLearningEngineDecision =
  | "ready_for_shadow"
  | "ready_for_canary"
  | "ready_for_broad"
  | "needs_review"
  | "blocked"
  | "rollback_review";

export type WhatsappLearningEngineComponent = {
  key: WhatsappLearningEngineComponentKey;
  issue: string;
  status: WhatsappLearningEngineComponentStatus;
  evidence: string[];
  reason: string;
};

export type WhatsappLearningEngineStatus = {
  createdAt: string;
  decision: WhatsappLearningEngineDecision;
  ready: boolean;
  blockingReasons: string[];
  warnings: string[];
  components: WhatsappLearningEngineComponent[];
  audit: {
    learningEngineVersion: typeof WHATSAPP_LEARNING_ENGINE_VERSION;
    metricsVersion: typeof WHATSAPP_QUALITY_METRICS_VERSION | null;
    driftVersion: typeof WHATSAPP_DRIFT_DETECTION_VERSION | null;
    governanceVersion: typeof WHATSAPP_LEARNING_GOVERNANCE_VERSION | null;
    promotionVersion: typeof WHATSAPP_GRADUAL_PROMOTION_VERSION | null;
    versioningPolicy: typeof WHATSAPP_LEARNING_VERSIONING_VERSION | null;
  };
  integrations: typeof WHATSAPP_LEARNING_ENGINE_POLICY.integrations;
};

type EngineMetricsReport = Pick<WhatsappQualityMetricsReport, "id" | "totals" | "segments" | "driftSnapshots" | "policyVersion" | "integrations">;
type EngineDriftAnalysis = Pick<WhatsappDriftAnalysis, "id" | "decision" | "findings" | "affectedVersions" | "promotionImpact" | "policyVersion">;
type EnginePromotionPlan = Pick<WhatsappPromotionPlan, "id" | "stage" | "candidate" | "qualityGate" | "reprocessing" | "policyVersion">;
type EngineLearningCandidate = Pick<WhatsappLearningCandidate, "id" | "status" | "kind" | "action" | "scope" | "evidence" | "rollbackPlan" | "version" | "metric" | "directGlobalPromotionAllowed" | "governanceVersion" | "privacy">;
type EngineReviewItem = Pick<WhatsappReviewQueueItem, "id" | "status" | "priority" | "impact" | "type" | "title">;
type EngineVersionSnapshot = Pick<WhatsappDecisionVersionSnapshot, "promptVersion" | "schemaVersion" | "globalRuleVersion" | "nutritionSourceVersion" | "confidenceCalibratorVersion" | "promotionPolicyVersion" | "governancePolicyVersion" | "versioningPolicy">;

export type BuildWhatsappLearningEngineStatusInput = {
  createdAt?: Date;
  metricsReport?: EngineMetricsReport | null;
  driftAnalysis?: EngineDriftAnalysis | null;
  promotionPlan?: EnginePromotionPlan | null;
  governanceCandidates?: EngineLearningCandidate[];
  reviewQueue?: EngineReviewItem[];
  versionSnapshot?: EngineVersionSnapshot | null;
};

export const WHATSAPP_LEARNING_ENGINE_POLICY = {
  minimumTraceabilityCoverageRate: 0.95,
  minimumEvaluatedMessages: 20,
  promotionReadyStages: ["shadow", "canary", "broad"],
  blockedReviewPriorities: ["critical"],
  reviewRequiredPriorities: ["high"],
  globalLearningStatuses: ["approved", "promoted"],
  directMutationAllowed: false,
  requiredComponents: [
    "privacy",
    "messageHistory",
    "feedback",
    "reviewQueue",
    "governance",
    "versioning",
    "reprocessing",
    "qualityGates",
    "gradualPromotion",
    "driftDetection",
    "qualityMetrics",
    "observability",
    "poisoningGuard",
  ] satisfies WhatsappLearningEngineComponentKey[],
  integrations: {
    epic: "#397",
    messageHistory: "#410",
    regressionDataset: "#413",
    reviewQueue: "#414",
    versioning: "#415",
    reprocessing: "#416",
    qualityMetrics: "#417",
    multiTurnRegression: "#428",
    orchestration: "#429",
    feedback: "#430",
    gradualPromotion: "#431",
    privacy: "#432",
    memory: "#433",
    drift: "#434",
    driftDetection: "#434",
    nutritionComparison: "#435",
    autonomy: "#436",
    injectionGuard: "#437",
    toolContract: "#438",
    replay: "#439",
    observability: "#440",
    negativeEvaluation: "#441",
    knowledgeValidity: "#442",
    governance: "#443",
    poisoningGuard: "#444",
    confidenceCalibration: "#445",
    qualityGates: "#446",
  },
  version: WHATSAPP_LEARNING_ENGINE_VERSION,
} as const;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function component(
  key: WhatsappLearningEngineComponentKey,
  status: WhatsappLearningEngineComponentStatus,
  reason: string,
  evidence: string[] = [],
): WhatsappLearningEngineComponent {
  return {
    key,
    issue: WHATSAPP_LEARNING_ENGINE_POLICY.integrations[key],
    status,
    evidence,
    reason,
  };
}

function openReviewItems(items: EngineReviewItem[] = []) {
  return items.filter(item => ["open", "in_review", "needs_more_info"].includes(item.status));
}

function hasApprovedGlobalCandidate(candidates: EngineLearningCandidate[] = []) {
  return candidates.some(candidate => (
    ["approved", "promoted"].includes(candidate.status)
    && ["global", "system"].includes(candidate.scope)
    && candidate.evidence.length >= 2
    && Boolean(candidate.rollbackPlan)
    && Boolean(candidate.version)
    && Boolean(candidate.metric)
    && candidate.directGlobalPromotionAllowed === false
    && candidate.governanceVersion === WHATSAPP_LEARNING_GOVERNANCE_VERSION
  ));
}

function hasUnsafeGlobalCandidate(candidates: EngineLearningCandidate[] = []) {
  return candidates.some(candidate => (
    ["global", "system"].includes(candidate.scope)
    && candidate.directGlobalPromotionAllowed !== false
  ));
}

function qualityGateStatus(plan?: EnginePromotionPlan | null) {
  const decision = plan?.qualityGate?.decision;
  if (!decision) return component("qualityGates", "missing", "Promocao de aprendizado exige gate objetivo antes de ampliar comportamento global.");
  if (decision === "reject" || decision === "rollback") return component("qualityGates", "blocked", "Gate de qualidade rejeitou a candidata ou exigiu rollback.", [`decision:${decision}`]);
  if (decision === "review") return component("qualityGates", "needs_review", "Gate de qualidade exige revisao humana antes de continuar.", [`decision:${decision}`]);
  return component("qualityGates", "ready", "Gate de qualidade aprovado para o estagio atual.", [`decision:${decision}`]);
}

function reprocessingStatus(plan?: EnginePromotionPlan | null) {
  const reprocessing = plan?.reprocessing;
  if (!reprocessing) return component("reprocessing", "missing", "Promocao exige reprocessamento ou replay offline rastreavel.");
  if (reprocessing.decision === "reject" || reprocessing.regressionCount > 0 || reprocessing.highImpactCount > 0) {
    return component("reprocessing", "blocked", "Replay detectou regressao ou impacto alto antes da promocao.", [
      `decision:${reprocessing.decision}`,
      `regressions:${reprocessing.regressionCount}`,
      `highImpact:${reprocessing.highImpactCount}`,
    ]);
  }
  return component("reprocessing", "ready", "Replay validou a candidata sem regressao relevante.", [`examples:${reprocessing.examplesTotal}`]);
}

function promotionStatus(plan?: EnginePromotionPlan | null) {
  if (!plan) return component("gradualPromotion", "missing", "Nao ha plano de promocao gradual vinculado ao aprendizado candidato.");
  if (["rejected", "rolled_back"].includes(plan.stage)) {
    return component("gradualPromotion", "blocked", "Plano de promocao foi rejeitado ou revertido.", [`plan:${plan.id}`, `stage:${plan.stage}`]);
  }
  if (plan.stage === "draft") {
    return component("gradualPromotion", "needs_review", "Plano ainda precisa iniciar sombra antes de qualquer exposicao controlada.", [`plan:${plan.id}`, `stage:${plan.stage}`]);
  }
  return component("gradualPromotion", "ready", "Plano esta em fluxo gradual controlado.", [`plan:${plan.id}`, `stage:${plan.stage}`, `candidate:${plan.candidate.candidateVersion}`]);
}

function driftStatus(analysis?: EngineDriftAnalysis | null) {
  if (!analysis) return component("driftDetection", "missing", "Promocao exige analise de drift por segmento e versao.");
  if (analysis.decision === "rollback_review") return component("driftDetection", "blocked", "Drift critico exige revisao de rollback antes de continuar.", [`analysis:${analysis.id}`, `decision:${analysis.decision}`]);
  if (analysis.decision === "block_promotion") return component("driftDetection", "blocked", "Drift critico bloqueia promocao da candidata.", [`analysis:${analysis.id}`, `decision:${analysis.decision}`]);
  if (analysis.decision === "review") return component("driftDetection", "needs_review", "Drift relevante exige revisao antes da promocao.", [`analysis:${analysis.id}`, `decision:${analysis.decision}`]);
  if (analysis.decision === "watch") return component("driftDetection", "needs_review", "Drift em observacao exige acompanhamento antes de ampliar a candidata.", [`analysis:${analysis.id}`, `decision:${analysis.decision}`]);
  return component("driftDetection", "ready", "Analise de drift esta estavel para a candidata.", [`analysis:${analysis.id}`, `policy:${analysis.policyVersion}`]);
}

function metricsStatus(report?: EngineMetricsReport | null) {
  if (!report) return component("qualityMetrics", "missing", "Motor exige relatorio protegido de metricas para avaliar aprendizado.");
  if (report.totals.messages < WHATSAPP_LEARNING_ENGINE_POLICY.minimumEvaluatedMessages) {
    return component("qualityMetrics", "needs_review", "Amostra de metricas ainda e pequena para promocao ampla.", [`messages:${report.totals.messages}`]);
  }
  if (report.totals.traceabilityCoverageRate < WHATSAPP_LEARNING_ENGINE_POLICY.minimumTraceabilityCoverageRate) {
    return component("qualityMetrics", "blocked", "Rastreabilidade abaixo do minimo para auditoria do aprendizado.", [`traceability:${report.totals.traceabilityCoverageRate}`]);
  }
  return component("qualityMetrics", "ready", "Metricas protegidas cobrem volume e rastreabilidade minimos.", [`report:${report.id}`, `segments:${report.segments.length}`]);
}

function reviewQueueStatus(items: EngineReviewItem[] = []) {
  const openItems = openReviewItems(items);
  const critical = openItems.filter(item => item.priority === "critical" || item.impact === "critical");
  const high = openItems.filter(item => item.priority === "high" || item.impact === "high");
  if (critical.length > 0) {
    return component("reviewQueue", "blocked", "Fila possui revisao critica aberta antes da promocao.", critical.map(item => `review:${item.id}`));
  }
  if (high.length > 0) {
    return component("reviewQueue", "needs_review", "Fila possui revisao de alto impacto pendente.", high.map(item => `review:${item.id}`));
  }
  return component("reviewQueue", "ready", "Fila de revisao nao possui bloqueios pendentes.", [`open:${openItems.length}`]);
}

function governanceStatus(candidates: EngineLearningCandidate[] = []) {
  if (hasUnsafeGlobalCandidate(candidates)) {
    return component("governance", "blocked", "Candidato global tentou permitir promocao direta sem governanca.");
  }
  if (!hasApprovedGlobalCandidate(candidates)) {
    return component("governance", "missing", "Promocao global exige candidato aprovado ou promovido com evidencia, versao, metrica e rollback.");
  }
  return component("governance", "ready", "Candidato global esta governado e auditavel.", candidates.map(candidate => `candidate:${candidate.id}`));
}

function versioningStatus(snapshot?: EngineVersionSnapshot | null) {
  if (!snapshot) return component("versioning", "missing", "Decisoes do motor precisam de snapshot de versoes ativo.");
  const missing = [
    ["prompt", snapshot.promptVersion],
    ["schema", snapshot.schemaVersion],
    ["globalRule", snapshot.globalRuleVersion],
    ["nutritionSource", snapshot.nutritionSourceVersion],
    ["confidenceCalibrator", snapshot.confidenceCalibratorVersion],
    ["promotionPolicy", snapshot.promotionPolicyVersion],
    ["governancePolicy", snapshot.governancePolicyVersion],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0 || snapshot.versioningPolicy !== WHATSAPP_LEARNING_VERSIONING_VERSION) {
    return component("versioning", "blocked", "Snapshot de versoes esta incompleto ou fora da politica esperada.", missing);
  }
  return component("versioning", "ready", "Snapshot de versoes cobre prompt, schema, regras, calibrador e politicas.", [snapshot.promptVersion, snapshot.schemaVersion]);
}

function privacyStatus(report?: EngineMetricsReport | null) {
  if (report?.integrations.retentionPrivacy !== "#432") {
    return component("privacy", "missing", "Metricas do aprendizado precisam declarar retencao e privacidade.");
  }
  return component("privacy", "ready", "Relatorio de metricas esta ligado a politica de privacidade e retencao.", [report.integrations.retentionPrivacy]);
}

function messageHistoryStatus(report?: EngineMetricsReport | null) {
  if (!report || report.driftSnapshots.length === 0) {
    return component("messageHistory", "missing", "Historico estruturado precisa alimentar metricas e snapshots de drift.");
  }
  return component("messageHistory", "ready", "Historico estruturado gerou segmentos auditaveis para o motor.", [`snapshots:${report.driftSnapshots.length}`]);
}

function feedbackStatus(report?: EngineMetricsReport | null) {
  if (!report) return component("feedback", "missing", "Feedback positivo, negativo e correcao precisam compor o relatorio de qualidade.");
  const totalFeedback = report.totals.feedbackPositive + report.totals.feedbackNegative + report.totals.feedbackCorrections;
  if (totalFeedback === 0) return component("feedback", "needs_review", "Nenhum feedback foi observado para sustentar aprendizado continuo.");
  return component("feedback", "ready", "Feedback esta agregado ao relatorio de qualidade.", [`feedback:${totalFeedback}`]);
}

function observabilityStatus(input: BuildWhatsappLearningEngineStatusInput) {
  if (!input.metricsReport || !input.driftAnalysis || !input.promotionPlan || !input.versionSnapshot) {
    return component("observability", "missing", "Observabilidade exige metricas, drift, promocao e versoes no mesmo status.");
  }
  return component("observability", "ready", "Status consolida metricas, drift, promocao e versoes para auditoria.", [
    `metrics:${input.metricsReport.id}`,
    `drift:${input.driftAnalysis.id}`,
    `promotion:${input.promotionPlan.id}`,
  ]);
}

function poisoningGuardStatus(candidates: EngineLearningCandidate[] = [], items: EngineReviewItem[] = []) {
  const unsafe = hasUnsafeGlobalCandidate(candidates);
  const suspiciousOpen = openReviewItems(items).filter(item => ["interpretation_failure", "negative_feedback", "regression_candidate"].includes(item.type));
  if (unsafe) return component("poisoningGuard", "blocked", "Protecao contra data poisoning bloqueou candidato global inseguro.");
  if (suspiciousOpen.some(item => item.priority === "critical" || item.impact === "critical")) {
    return component("poisoningGuard", "blocked", "Sinal suspeito critico esta aberto na fila de revisao.");
  }
  if (suspiciousOpen.length > 0) {
    return component("poisoningGuard", "needs_review", "Sinais suspeitos ainda precisam de revisao antes de promover aprendizado.", suspiciousOpen.map(item => `review:${item.id}`));
  }
  return component("poisoningGuard", "ready", "Candidatos e fila nao indicam promocao direta ou sinais suspeitos pendentes.");
}

function decisionFrom(components: WhatsappLearningEngineComponent[], drift?: EngineDriftAnalysis | null, plan?: EnginePromotionPlan | null): WhatsappLearningEngineDecision {
  if (drift?.decision === "rollback_review") return "rollback_review";
  if (components.some(item => item.status === "blocked" || item.status === "missing")) return "blocked";
  if (components.some(item => item.status === "needs_review")) return "needs_review";
  if (plan?.stage === "broad") return "ready_for_broad";
  if (plan?.stage === "canary") return "ready_for_canary";
  return "ready_for_shadow";
}

export function buildWhatsappLearningEngineStatus(input: BuildWhatsappLearningEngineStatusInput): WhatsappLearningEngineStatus {
  const components = [
    privacyStatus(input.metricsReport),
    messageHistoryStatus(input.metricsReport),
    feedbackStatus(input.metricsReport),
    reviewQueueStatus(input.reviewQueue),
    governanceStatus(input.governanceCandidates),
    versioningStatus(input.versionSnapshot),
    reprocessingStatus(input.promotionPlan),
    qualityGateStatus(input.promotionPlan),
    promotionStatus(input.promotionPlan),
    driftStatus(input.driftAnalysis),
    metricsStatus(input.metricsReport),
    observabilityStatus(input),
    poisoningGuardStatus(input.governanceCandidates, input.reviewQueue),
  ];
  const decision = decisionFrom(components, input.driftAnalysis, input.promotionPlan);
  const blockingReasons = components
    .filter(item => item.status === "blocked" || item.status === "missing")
    .map(item => item.reason);
  const warnings = components
    .filter(item => item.status === "needs_review")
    .map(item => item.reason);

  return {
    createdAt: toIso(input.createdAt),
    decision,
    ready: decision.startsWith("ready_for_"),
    blockingReasons,
    warnings,
    components,
    audit: {
      learningEngineVersion: WHATSAPP_LEARNING_ENGINE_VERSION,
      metricsVersion: input.metricsReport?.policyVersion ?? null,
      driftVersion: input.driftAnalysis?.policyVersion ?? null,
      governanceVersion: input.governanceCandidates?.[0]?.governanceVersion ?? null,
      promotionVersion: input.promotionPlan?.policyVersion ?? null,
      versioningPolicy: input.versionSnapshot?.versioningPolicy ?? null,
    },
    integrations: WHATSAPP_LEARNING_ENGINE_POLICY.integrations,
  };
}
