import type { WhatsappQualityGateResult, WhatsappQualityMetricName } from "./qualityGates";
import type { WhatsappReprocessingRun } from "./learningReprocessing";
import type { WhatsappVersionedArtifactCategory } from "./learningVersioning";

export const WHATSAPP_GRADUAL_PROMOTION_VERSION = "whatsapp-gradual-promotion/v1";

export type WhatsappGradualPromotionStage = "draft" | "shadow" | "canary" | "broad" | "rejected" | "rolled_back";
export type WhatsappGradualPromotionDecision = "shadow_started" | "canary_started" | "promoted" | "rejected" | "rollback_required" | "rolled_back" | "review_required";
export type WhatsappGradualPromotionScope = "internal" | "low_risk_users" | "single_intent" | "percentage" | "all_users";
export type WhatsappShadowComparisonOutcome = "same" | "candidate_better" | "candidate_worse" | "needs_review";

export type WhatsappPromotionCandidate = {
  id: string;
  name: string;
  artifactCategory: WhatsappVersionedArtifactCategory;
  currentVersion: string;
  candidateVersion: string;
  objective: string;
  risk: "low" | "medium" | "high" | "critical";
  createdAt: string;
  createdBy: string;
};

export type WhatsappShadowComparison = {
  id: string;
  messageId: string;
  intent: string;
  currentVersion: string;
  candidateVersion: string;
  currentDecision: string;
  candidateDecision: string;
  currentPersisted: boolean;
  candidatePersisted: boolean;
  currentConfidence: number;
  candidateConfidence: number;
  outcome: WhatsappShadowComparisonOutcome;
  reason: string;
};

export type WhatsappPromotionPlan = {
  id: number;
  candidate: WhatsappPromotionCandidate;
  stage: WhatsappGradualPromotionStage;
  scope: WhatsappGradualPromotionScope;
  percentage: number;
  startedAt: string;
  updatedAt: string;
  shadowComparisons: WhatsappShadowComparison[];
  qualityGate: Pick<WhatsappQualityGateResult, "decision" | "objectiveScore" | "blockingFindings" | "warnings"> | null;
  reprocessing: Pick<WhatsappReprocessingRun, "decision" | "regressionCount" | "highImpactCount" | "examplesTotal"> | null;
  decisions: Array<{ at: string; decision: WhatsappGradualPromotionDecision; actor: string; reason: string; fromStage: WhatsappGradualPromotionStage; toStage: WhatsappGradualPromotionStage }>;
  rollback: { at: string; actor: string; reason: string; restoredVersion: string } | null;
  policyVersion: typeof WHATSAPP_GRADUAL_PROMOTION_VERSION;
};

export type WhatsappPromotionEvaluation = {
  allowed: boolean;
  decision: WhatsappGradualPromotionDecision;
  reason: string;
  targetStage: WhatsappGradualPromotionStage;
  requiredMetrics: WhatsappQualityMetricName[];
  policyVersion: typeof WHATSAPP_GRADUAL_PROMOTION_VERSION;
};

type CreatePlanInput = {
  candidate: Omit<WhatsappPromotionCandidate, "createdAt"> & { createdAt?: Date };
  createdAt?: Date;
};

type AdvanceInput = {
  planId: number;
  actor: string;
  targetStage: Extract<WhatsappGradualPromotionStage, "shadow" | "canary" | "broad">;
  scope?: WhatsappGradualPromotionScope;
  percentage?: number;
  qualityGate?: WhatsappPromotionPlan["qualityGate"];
  reprocessing?: WhatsappPromotionPlan["reprocessing"];
  reason?: string;
  advancedAt?: Date;
};

const plans: WhatsappPromotionPlan[] = [];
let nextPlanId = 1;

export const WHATSAPP_GRADUAL_PROMOTION_POLICY = {
  stages: {
    shadow: "Executa candidata em paralelo, sem aplicar decisao ao usuario, sem gravar efeitos reais e comparando contra versao atual.",
    canary: "Libera candidata para escopo controlado apos sombra e gates minimos.",
    broad: "Promove candidata amplamente apenas apos gates objetivos, reprocessamento sem regressao e canary aceitavel.",
    rollback: "Restaura versao anterior quando metricas criticas, regressao ou gates exigirem reversao.",
  },
  minCanaryPercentage: 1,
  maxInitialCanaryPercentage: 10,
  broadPromotionPercentage: 100,
  requiredMetrics: ["false_positive_food_rate", "wrong_persistence_rate", "intent_accuracy", "calibrated_low_confidence_rate", "later_correction_rate", "p95_latency_ms", "cost_per_message"] satisfies WhatsappQualityMetricName[],
  directProductionChangeAllowed: false,
  integrations: {
    versioning: "#415",
    reprocessing: "#416",
    metrics: "#417",
    orchestration: "#429",
    feedbackLoop: "#430",
    drift: "#434",
    qualityGates: "#446",
  },
  version: WHATSAPP_GRADUAL_PROMOTION_VERSION,
} as const;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function findPlan(planId: number) {
  return plans.find(plan => plan.id === planId) ?? null;
}

function gateAllows(stage: Extract<WhatsappGradualPromotionStage, "shadow" | "canary" | "broad">, gate: WhatsappPromotionPlan["qualityGate"]) {
  if (!gate) return stage === "shadow";
  if (gate.blockingFindings.length > 0 || gate.decision === "reject" || gate.decision === "rollback") return false;
  if (stage === "shadow") return gate.decision === "approve_shadow" || gate.decision === "approve_canary" || gate.decision === "approve_broad";
  if (stage === "canary") return gate.decision === "approve_canary" || gate.decision === "approve_broad";
  return gate.decision === "approve_broad";
}

function reprocessingAllows(stage: Extract<WhatsappGradualPromotionStage, "shadow" | "canary" | "broad">, reprocessing: WhatsappPromotionPlan["reprocessing"]) {
  if (!reprocessing) return stage === "shadow";
  if (reprocessing.regressionCount > 0 || reprocessing.decision === "reject") return false;
  if (stage === "broad" && reprocessing.highImpactCount > 0) return false;
  return true;
}

function hasBadShadowComparisons(plan: WhatsappPromotionPlan) {
  return plan.shadowComparisons.some(item => item.outcome === "candidate_worse" || item.outcome === "needs_review");
}

function evaluateAdvance(input: { plan: WhatsappPromotionPlan; targetStage: Extract<WhatsappGradualPromotionStage, "shadow" | "canary" | "broad">; qualityGate?: WhatsappPromotionPlan["qualityGate"]; reprocessing?: WhatsappPromotionPlan["reprocessing"] }): WhatsappPromotionEvaluation {
  const gate = input.qualityGate ?? input.plan.qualityGate;
  const reprocessing = input.reprocessing ?? input.plan.reprocessing;
  if (input.plan.stage === "rolled_back" || input.plan.stage === "rejected") {
    return { allowed: false, decision: "review_required", reason: "Plano encerrado nao pode ser promovido novamente sem novo candidato.", targetStage: input.plan.stage, requiredMetrics: [...WHATSAPP_GRADUAL_PROMOTION_POLICY.requiredMetrics], policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION };
  }
  if (input.targetStage === "canary" && input.plan.stage !== "shadow") {
    return { allowed: false, decision: "review_required", reason: "Canary exige execucao previa em modo sombra.", targetStage: input.plan.stage, requiredMetrics: [...WHATSAPP_GRADUAL_PROMOTION_POLICY.requiredMetrics], policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION };
  }
  if (input.targetStage === "broad" && input.plan.stage !== "canary") {
    return { allowed: false, decision: "review_required", reason: "Promocao ampla exige canary previo em escopo controlado.", targetStage: input.plan.stage, requiredMetrics: [...WHATSAPP_GRADUAL_PROMOTION_POLICY.requiredMetrics], policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION };
  }
  if (input.targetStage !== "shadow" && hasBadShadowComparisons(input.plan)) {
    return { allowed: false, decision: "review_required", reason: "Comparacoes em sombra indicam piora ou revisao pendente.", targetStage: input.plan.stage, requiredMetrics: [...WHATSAPP_GRADUAL_PROMOTION_POLICY.requiredMetrics], policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION };
  }
  if (!gateAllows(input.targetStage, gate)) {
    return { allowed: false, decision: gate?.decision === "rollback" ? "rollback_required" : "rejected", reason: "Quality gates nao permitem avancar a candidata para este estagio.", targetStage: input.plan.stage, requiredMetrics: [...WHATSAPP_GRADUAL_PROMOTION_POLICY.requiredMetrics], policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION };
  }
  if (!reprocessingAllows(input.targetStage, reprocessing)) {
    return { allowed: false, decision: "rejected", reason: "Reprocessamento encontrou regressao ou impacto alto demais para o estagio solicitado.", targetStage: input.plan.stage, requiredMetrics: [...WHATSAPP_GRADUAL_PROMOTION_POLICY.requiredMetrics], policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION };
  }
  const decision = input.targetStage === "shadow" ? "shadow_started" : input.targetStage === "canary" ? "canary_started" : "promoted";
  return { allowed: true, decision, reason: "Candidata atende aos criterios objetivos do estagio solicitado.", targetStage: input.targetStage, requiredMetrics: [...WHATSAPP_GRADUAL_PROMOTION_POLICY.requiredMetrics], policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION };
}

function recordDecision(plan: WhatsappPromotionPlan, input: { at: string; decision: WhatsappGradualPromotionDecision; actor: string; reason: string; fromStage: WhatsappGradualPromotionStage; toStage: WhatsappGradualPromotionStage }) {
  plan.decisions.push(input);
}

export function createWhatsappPromotionPlan(input: CreatePlanInput): WhatsappPromotionPlan {
  const startedAt = toIso(input.createdAt ?? input.candidate.createdAt);
  const plan: WhatsappPromotionPlan = {
    id: nextPlanId,
    candidate: { ...input.candidate, createdAt: startedAt },
    stage: "draft",
    scope: "internal",
    percentage: 0,
    startedAt,
    updatedAt: startedAt,
    shadowComparisons: [],
    qualityGate: null,
    reprocessing: null,
    decisions: [],
    rollback: null,
    policyVersion: WHATSAPP_GRADUAL_PROMOTION_VERSION,
  };
  nextPlanId += 1;
  plans.push(plan);
  return plan;
}

export function recordWhatsappShadowComparison(input: { planId: number; comparison: Omit<WhatsappShadowComparison, "id" | "currentVersion" | "candidateVersion"> }) {
  const plan = findPlan(input.planId);
  if (!plan || plan.stage !== "shadow") return null;
  const comparison: WhatsappShadowComparison = {
    ...input.comparison,
    id: `shadow-${plan.id}-${plan.shadowComparisons.length + 1}`,
    currentVersion: plan.candidate.currentVersion,
    candidateVersion: plan.candidate.candidateVersion,
  };
  plan.shadowComparisons.push(comparison);
  return comparison;
}

export function advanceWhatsappPromotion(input: AdvanceInput) {
  const plan = findPlan(input.planId);
  if (!plan) return null;
  const evaluation = evaluateAdvance({ plan, targetStage: input.targetStage, qualityGate: input.qualityGate, reprocessing: input.reprocessing });
  const at = toIso(input.advancedAt);
  const fromStage = plan.stage;
  if (!evaluation.allowed) {
    const toStage = evaluation.decision === "rejected" ? "rejected" : fromStage;
    if (evaluation.decision === "rejected") plan.stage = "rejected";
    plan.updatedAt = at;
    recordDecision(plan, { at, decision: evaluation.decision, actor: input.actor, reason: input.reason ?? evaluation.reason, fromStage, toStage });
    return { plan, evaluation };
  }

  plan.stage = input.targetStage;
  plan.scope = input.scope ?? (input.targetStage === "shadow" ? "internal" : input.targetStage === "canary" ? "percentage" : "all_users");
  plan.percentage = input.targetStage === "shadow" ? 0 : input.targetStage === "canary" ? clampPercentage(input.percentage ?? WHATSAPP_GRADUAL_PROMOTION_POLICY.minCanaryPercentage) : WHATSAPP_GRADUAL_PROMOTION_POLICY.broadPromotionPercentage;
  plan.qualityGate = input.qualityGate ?? plan.qualityGate;
  plan.reprocessing = input.reprocessing ?? plan.reprocessing;
  plan.updatedAt = at;
  recordDecision(plan, { at, decision: evaluation.decision, actor: input.actor, reason: input.reason ?? evaluation.reason, fromStage, toStage: plan.stage });
  return { plan, evaluation };
}

export function rollbackWhatsappPromotion(input: { planId: number; actor: string; reason: string; rolledBackAt?: Date }) {
  const plan = findPlan(input.planId);
  if (!plan || plan.stage === "rolled_back") return null;
  const at = toIso(input.rolledBackAt);
  const fromStage = plan.stage;
  plan.stage = "rolled_back";
  plan.scope = "internal";
  plan.percentage = 0;
  plan.updatedAt = at;
  plan.rollback = { at, actor: input.actor, reason: input.reason, restoredVersion: plan.candidate.currentVersion };
  recordDecision(plan, { at, decision: "rolled_back", actor: input.actor, reason: input.reason, fromStage, toStage: "rolled_back" });
  return plan;
}

export function evaluateWhatsappPromotionReadiness(planId: number, targetStage: Extract<WhatsappGradualPromotionStage, "shadow" | "canary" | "broad">) {
  const plan = findPlan(planId);
  if (!plan) return null;
  return evaluateAdvance({ plan, targetStage });
}

export function listWhatsappPromotionPlans(filter: Partial<Pick<WhatsappPromotionPlan, "stage" | "scope">> = {}) {
  return plans.filter(plan => {
    if (filter.stage && plan.stage !== filter.stage) return false;
    if (filter.scope && plan.scope !== filter.scope) return false;
    return true;
  });
}

export function __resetWhatsappGradualPromotionForTests() {
  plans.length = 0;
  nextPlanId = 1;
}
