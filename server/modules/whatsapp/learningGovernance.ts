import { createHash } from "node:crypto";
import {
  buildAiLearningPrivacyRecord,
  containsDirectIdentifier,
  type AiLearningPrivacyRecord,
} from "../aiLearningPrivacy";
import type { WhatsappReviewDecisionResult, WhatsappReviewQueueItem } from "./reviewQueue";
import {
  listPersistedWhatsappLearningArtifacts,
  persistWhatsappLearningArtifact,
} from "./learningArtifactPersistence";
import type { WhatsappQualityGateResult } from "./qualityGates";
import type { WhatsappPromotionEvaluation } from "./gradualPromotion";

export const WHATSAPP_LEARNING_GOVERNANCE_VERSION = "whatsapp-learning-governance/v1";

export type WhatsappLearningAutonomyLevel = "automatic" | "suggestion" | "review_required" | "blocked";
export type WhatsappLearningAction =
  | "record_signal"
  | "create_hypothesis"
  | "group_recurring_error"
  | "suggest_regression_example"
  | "run_offline_simulation"
  | "propose_global_rule"
  | "propose_prompt_change"
  | "propose_schema_change"
  | "propose_threshold_change"
  | "propose_curated_nutrition_source"
  | "promote_global_rule"
  | "activate_prompt_or_schema"
  | "change_learning_autonomy"
  | "rollback_learning_change"
  | "recalculate_historical_data"
  | "direct_llm_mutation";
export type WhatsappLearningChangeKind =
  | "signal"
  | "hypothesis"
  | "regression_fixture"
  | "simulation_report"
  | "global_rule"
  | "prompt"
  | "schema"
  | "threshold"
  | "curated_nutrition_source"
  | "autonomy_policy"
  | "rollback"
  | "historical_recalculation";
export type WhatsappLearningApprovalRole =
  | "administrator"
  | "nutrition_curator"
  | "authorized_professional"
  | "technical_reviewer"
  | "controlled_automation";
export type WhatsappLearningApprovalPolicy = "none" | "single" | "double" | "restricted_automatic" | "blocked";
export type WhatsappLearningCandidateStatus = "recorded" | "suggested" | "needs_review" | "approved" | "rejected" | "promoted" | "rolled_back";
export type WhatsappLearningRiskLevel = "low" | "medium" | "high" | "critical";
export type WhatsappLearningAuditEventType =
  | "candidate_created"
  | "approval_recorded"
  | "rejection_recorded"
  | "promotion_blocked"
  | "promotion_recorded"
  | "rollback_recorded"
  | "direct_change_blocked";

export type WhatsappLearningGovernanceMatrixEntry = {
  action: WhatsappLearningAction;
  level: WhatsappLearningAutonomyLevel;
  approvalPolicy: WhatsappLearningApprovalPolicy;
  allowedRoles: WhatsappLearningApprovalRole[];
  requiredEvidence: number;
  rollbackRequired: boolean;
  versionRequired: boolean;
  auditRequired: boolean;
  description: string;
};

export type WhatsappLearningCandidate = {
  id: number;
  createdAt: string;
  updatedAt: string;
  kind: WhatsappLearningChangeKind;
  action: WhatsappLearningAction;
  status: WhatsappLearningCandidateStatus;
  origin: string;
  scope: "individual" | "cohort" | "global" | "system";
  title: string;
  rationale: string;
  evidence: Array<{ source: string; reference: string; summary: string; userIdHash?: string; identityKey?: string }>;
  risk: WhatsappLearningRiskLevel;
  expectedImpact: string;
  rollbackPlan: string | null;
  version: string | null;
  metric: string | null;
  payload: Record<string, unknown>;
  sourceReviewQueueItemId: number | null;
  sourceReviewDecision: WhatsappReviewDecisionResult | null;
  directGlobalPromotionAllowed: false;
  distinctUserCount: number;
  conflictDetected: boolean;
  governanceChecks: {
    required: boolean;
    replayDecision: "approve" | "review" | "reject" | "shadow" | null;
    qualityGateDecision: string | null;
    positiveCases: number;
    negativeCases: number;
    ambiguousCases: number;
    multiTurnCases: number;
  };
  qualityGate: Pick<WhatsappQualityGateResult, "decision" | "targetStage" | "blockingFindings" | "warnings"> | null;
  gradualPromotion: Pick<WhatsappPromotionEvaluation, "allowed" | "decision" | "targetStage" | "reason"> | null;
  governanceVersion: typeof WHATSAPP_LEARNING_GOVERNANCE_VERSION;
  privacy: AiLearningPrivacyRecord;
  approvals: Array<{ role: WhatsappLearningApprovalRole; reviewer: string; justification: string; decidedAt: string }>;
  rejection: { role: WhatsappLearningApprovalRole; reviewer: string; justification: string; decidedAt: string } | null;
  promotion: { promotedAt: string; promotedBy: string; role: WhatsappLearningApprovalRole; version: string; rollbackPlan: string; metric: string } | null;
  rollback: { rolledBackAt: string; rolledBackBy: string; role: WhatsappLearningApprovalRole; reason: string; restoredVersion: string | null } | null;
};

export type WhatsappLearningAuditEvent = {
  id: number;
  createdAt: string;
  type: WhatsappLearningAuditEventType;
  candidateId: number | null;
  actor: string;
  role: WhatsappLearningApprovalRole | "llm" | "system";
  action: WhatsappLearningAction | null;
  status: WhatsappLearningCandidateStatus | "blocked";
  justification: string;
  governanceVersion: typeof WHATSAPP_LEARNING_GOVERNANCE_VERSION;
};

export type WhatsappLearningGovernanceDecision = {
  allowed: boolean;
  reason: string;
  policy: WhatsappLearningGovernanceMatrixEntry;
};

type RecordLearningCandidateInput = {
  kind: WhatsappLearningChangeKind;
  action: WhatsappLearningAction;
  origin: string;
  scope: WhatsappLearningCandidate["scope"];
  title: string;
  rationale: string;
  evidence?: WhatsappLearningCandidate["evidence"];
  risk?: WhatsappLearningRiskLevel;
  expectedImpact?: string;
  rollbackPlan?: string | null;
  version?: string | null;
  metric?: string | null;
  payload?: Record<string, unknown>;
  sourceReviewQueueItem?: WhatsappReviewQueueItem | null;
  qualityGate?: Pick<WhatsappQualityGateResult, "decision" | "targetStage" | "blockingFindings" | "warnings"> | null;
  gradualPromotion?: Pick<WhatsappPromotionEvaluation, "allowed" | "decision" | "targetStage" | "reason"> | null;
  createdAt?: Date;
};

const candidates: WhatsappLearningCandidate[] = [];
const auditEvents: WhatsappLearningAuditEvent[] = [];
let nextCandidateId = 1;
let nextAuditId = 1;

export const WHATSAPP_LEARNING_GOVERNANCE_MATRIX: WhatsappLearningGovernanceMatrixEntry[] = [
  { action: "record_signal", level: "automatic", approvalPolicy: "none", allowedRoles: ["controlled_automation"], requiredEvidence: 0, rollbackRequired: false, versionRequired: false, auditRequired: true, description: "Registrar sinal operacional, feedback ou erro sem alterar comportamento global." },
  { action: "create_hypothesis", level: "automatic", approvalPolicy: "none", allowedRoles: ["controlled_automation"], requiredEvidence: 1, rollbackRequired: false, versionRequired: false, auditRequired: true, description: "Criar hipotese ou agrupamento para analise posterior." },
  { action: "group_recurring_error", level: "automatic", approvalPolicy: "none", allowedRoles: ["controlled_automation"], requiredEvidence: 1, rollbackRequired: false, versionRequired: false, auditRequired: true, description: "Agrupar erro recorrente ou divergencia para revisao." },
  { action: "suggest_regression_example", level: "suggestion", approvalPolicy: "single", allowedRoles: ["technical_reviewer", "controlled_automation"], requiredEvidence: 1, rollbackRequired: false, versionRequired: true, auditRequired: true, description: "Sugerir fixture ou caso de teste sem promocao de regra ativa." },
  { action: "run_offline_simulation", level: "automatic", approvalPolicy: "none", allowedRoles: ["controlled_automation", "technical_reviewer"], requiredEvidence: 0, rollbackRequired: false, versionRequired: true, auditRequired: true, description: "Rodar simulacao ou replay dry-run sem efeito em producao." },
  { action: "propose_global_rule", level: "review_required", approvalPolicy: "double", allowedRoles: ["administrator", "technical_reviewer", "nutrition_curator"], requiredEvidence: 2, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Propor regra global candidata separada de memoria individual e conhecimento aprovado." },
  { action: "propose_prompt_change", level: "review_required", approvalPolicy: "double", allowedRoles: ["administrator", "technical_reviewer"], requiredEvidence: 2, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Propor ajuste de prompt ativo sujeito a gate, revisao e rollback." },
  { action: "propose_schema_change", level: "review_required", approvalPolicy: "double", allowedRoles: ["administrator", "technical_reviewer"], requiredEvidence: 2, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Propor alteracao de schema ativo sujeita a revisao tecnica." },
  { action: "propose_threshold_change", level: "review_required", approvalPolicy: "single", allowedRoles: ["administrator", "technical_reviewer"], requiredEvidence: 2, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Propor alteracao de threshold com metrica esperada e reversao." },
  { action: "propose_curated_nutrition_source", level: "review_required", approvalPolicy: "single", allowedRoles: ["nutrition_curator", "authorized_professional"], requiredEvidence: 1, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Propor fonte nutricional curada sem ativa-la globalmente direto." },
  { action: "promote_global_rule", level: "review_required", approvalPolicy: "double", allowedRoles: ["administrator", "technical_reviewer", "nutrition_curator"], requiredEvidence: 2, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Promover regra global apenas com evidencia, versao, escopo, metrica, aprovacao e rollback." },
  { action: "activate_prompt_or_schema", level: "review_required", approvalPolicy: "double", allowedRoles: ["administrator", "technical_reviewer"], requiredEvidence: 2, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Ativar prompt ou schema somente por fluxo governado." },
  { action: "change_learning_autonomy", level: "review_required", approvalPolicy: "double", allowedRoles: ["administrator", "technical_reviewer"], requiredEvidence: 2, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Alterar politica de autonomia do aprendizado com aprovacao explicita." },
  { action: "rollback_learning_change", level: "review_required", approvalPolicy: "single", allowedRoles: ["administrator", "technical_reviewer"], requiredEvidence: 1, rollbackRequired: false, versionRequired: true, auditRequired: true, description: "Executar rollback rastreavel de mudanca de aprendizado." },
  { action: "recalculate_historical_data", level: "review_required", approvalPolicy: "double", allowedRoles: ["administrator", "technical_reviewer"], requiredEvidence: 2, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Recalcular historico apenas com escopo, evidencia e plano de restauracao." },
  { action: "direct_llm_mutation", level: "blocked", approvalPolicy: "blocked", allowedRoles: [], requiredEvidence: Number.POSITIVE_INFINITY, rollbackRequired: true, versionRequired: true, auditRequired: true, description: "Bloqueia saida livre da LLM tentando alterar prompt, schema, regra global, memoria global ou autonomia." },
];

export const WHATSAPP_LEARNING_GOVERNANCE_INTEGRATIONS = {
  reviewQueue: "#414",
  versioning: "#415",
  driftMetrics: "#431",
  privacy: "#432",
  knowledgeValidity: "#434",
  gradualPromotion: "#442",
  governanceAudit: "#417",
} as const;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function hashValue(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function getPolicy(action: WhatsappLearningAction) {
  const policy = WHATSAPP_LEARNING_GOVERNANCE_MATRIX.find(entry => entry.action === action);
  if (!policy) throw new Error(`Acao de aprendizado sem politica de governanca: ${action}`);
  return policy;
}

function defaultStatus(policy: WhatsappLearningGovernanceMatrixEntry): WhatsappLearningCandidateStatus {
  if (policy.level === "automatic") return "recorded";
  if (policy.level === "suggestion") return "suggested";
  return policy.level === "blocked" ? "rejected" : "needs_review";
}

function buildPrivacy(createdAt: string) {
  return buildAiLearningPrivacyRecord({ kind: "candidate_rule", purpose: "global_learning", origin: "whatsapp-learning-governance", createdAt, scope: "global" });
}

function recordAudit(input: Omit<WhatsappLearningAuditEvent, "id" | "createdAt" | "governanceVersion"> & { createdAt?: string }) {
  const event: WhatsappLearningAuditEvent = {
    id: nextAuditId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    type: input.type,
    candidateId: input.candidateId,
    actor: input.actor,
    role: input.role,
    action: input.action,
    status: input.status,
    justification: input.justification,
    governanceVersion: WHATSAPP_LEARNING_GOVERNANCE_VERSION,
  };
  nextAuditId += 1;
  auditEvents.push(event);
  void persistWhatsappLearningAuditEvent(event);
  return event;
}

function requiredApprovals(policy: WhatsappLearningGovernanceMatrixEntry) {
  if (policy.approvalPolicy === "none") return 0;
  if (policy.approvalPolicy === "single" || policy.approvalPolicy === "restricted_automatic") return 1;
  if (policy.approvalPolicy === "double") return 2;
  return Number.POSITIVE_INFINITY;
}

function policyAllowsRole(policy: WhatsappLearningGovernanceMatrixEntry, role: WhatsappLearningApprovalRole) {
  return policy.allowedRoles.includes(role);
}

function approvalCount(candidate: WhatsappLearningCandidate, policy: WhatsappLearningGovernanceMatrixEntry) {
  const accepted = candidate.approvals.filter(approval => policyAllowsRole(policy, approval.role));
  return policy.approvalPolicy === "double" ? new Set(accepted.map(approval => approval.role)).size : accepted.length;
}

function promotionPolicyFor(candidate: WhatsappLearningCandidate) {
  if (candidate.action === "propose_prompt_change" || candidate.action === "propose_schema_change") return getPolicy("activate_prompt_or_schema");
  if (candidate.action === "propose_global_rule") return getPolicy("promote_global_rule");
  return getPolicy(candidate.action);
}

function missingPromotionMetadata(candidate: WhatsappLearningCandidate, policy: WhatsappLearningGovernanceMatrixEntry) {
  const missing: string[] = [];
  if (!candidate.origin.trim()) missing.push("origem");
  if (!candidate.scope) missing.push("escopo");
  if (candidate.evidence.length < policy.requiredEvidence) missing.push("evidencia");
  if (policy.versionRequired && !candidate.version) missing.push("versao");
  if (!candidate.rationale.trim()) missing.push("justificativa");
  if (!candidate.expectedImpact.trim()) missing.push("impacto esperado");
  if (!candidate.metric?.trim()) missing.push("metrica esperada");
  if (policy.rollbackRequired && !candidate.rollbackPlan?.trim()) missing.push("rollback");
  return missing;
}

function payloadContainsIdentifier(payload: Record<string, unknown>) {
  const { governanceFingerprint: _governanceFingerprint, ...auditablePayload } = payload;
  return containsDirectIdentifier(JSON.stringify(auditablePayload));
}

function governanceEvidence(payload: Record<string, unknown>, evidence: WhatsappLearningCandidate["evidence"]) {
  const sourceUserIds = Array.isArray(payload.sourceUserIds)
    ? payload.sourceUserIds.filter((id): id is number => Number.isInteger(id) && id > 0)
    : [];
  const evidenceUserHashes = evidence.map(item => item.userIdHash).filter((hash): hash is string => Boolean(hash));
  const distinctUserCount = Number.isFinite(Number(payload.distinctUserCount))
    ? Math.max(0, Math.trunc(Number(payload.distinctUserCount)))
    : sourceUserIds.length > 0 ? new Set(sourceUserIds).size : new Set(evidenceUserHashes).size;
  const coverage = payload.coverage && typeof payload.coverage === "object"
    ? payload.coverage as Record<string, unknown>
    : {};
  const required = payload.requiresMultiUserEvidence === true
    || payload.requiresGovernedPromotion === true
    || sourceUserIds.length > 0
    || evidenceUserHashes.length > 0;
  return {
    required,
    distinctUserCount,
    conflictDetected: payload.conflictDetected === true
      || payload.materialConflict === true
      || new Set(evidence.map(item => item.identityKey).filter(Boolean)).size > 1,
    replayDecision: ["approve", "review", "reject", "shadow"].includes(String(payload.replayDecision))
      ? String(payload.replayDecision) as "approve" | "review" | "reject" | "shadow"
      : null,
    qualityGateDecision: typeof payload.qualityGateDecision === "string" ? payload.qualityGateDecision : null,
    positiveCases: Math.max(0, Math.trunc(Number(coverage.positiveCases ?? 0))),
    negativeCases: Math.max(0, Math.trunc(Number(coverage.negativeCases ?? 0))),
    ambiguousCases: Math.max(0, Math.trunc(Number(coverage.ambiguousCases ?? 0))),
    multiTurnCases: Math.max(0, Math.trunc(Number(coverage.multiTurnCases ?? 0))),
    evidenceCount: evidence.length,
  };
}

export function aggregateWhatsappLearningEvidence(input: Array<{
  userId: number;
  identityKey: string;
  summary?: string;
}>) {
  const sourceUserIds = [...new Set(input.filter(item => Number.isInteger(item.userId) && item.userId > 0).map(item => item.userId))];
  const byIdentity = new Map<string, { count: number; userIds: number[]; summaries: string[] }>();
  for (const item of input) {
    const current = byIdentity.get(item.identityKey) ?? { count: 0, userIds: [], summaries: [] };
    current.count += 1;
    if (!current.userIds.includes(item.userId)) current.userIds.push(item.userId);
    if (item.summary) current.summaries.push(item.summary);
    byIdentity.set(item.identityKey, current);
  }
  return {
    frequency: input.length,
    distinctUserCount: sourceUserIds.length,
    sourceUserIds,
    conflictDetected: byIdentity.size > 1,
    identities: [...byIdentity.entries()].map(([identityKey, value]) => ({ identityKey, ...value })),
  };
}

export function getWhatsappLearningGovernancePolicy(action: WhatsappLearningAction) {
  return getPolicy(action);
}

export function listWhatsappLearningGovernanceMatrix() {
  return [...WHATSAPP_LEARNING_GOVERNANCE_MATRIX];
}

export function recordWhatsappLearningCandidate(input: RecordLearningCandidateInput) {
  const createdAt = toIso(input.createdAt);
  const policy = getPolicy(input.action);
  const payload = input.payload ?? {};
  const governanceEvidenceResult = governanceEvidence(payload, input.evidence ?? []);
  const auditablePayload: Record<string, unknown> = { ...payload, distinctUserCount: governanceEvidenceResult.distinctUserCount };
  delete auditablePayload.sourceUserIds;
  const candidate: WhatsappLearningCandidate = {
    id: nextCandidateId,
    createdAt,
    updatedAt: createdAt,
    kind: input.kind,
    action: input.action,
    status: defaultStatus(policy),
    origin: input.origin,
    scope: input.scope,
    title: input.title,
    rationale: input.rationale,
    evidence: input.evidence ?? [],
    risk: input.risk ?? (policy.level === "review_required" ? "high" : "low"),
    expectedImpact: input.expectedImpact ?? "Sem impacto esperado declarado.",
    rollbackPlan: input.rollbackPlan ?? null,
    version: input.version ?? null,
    metric: input.metric ?? null,
    payload: { ...auditablePayload, governanceFingerprint: hashValue(JSON.stringify({ title: input.title, origin: input.origin, payload: auditablePayload })) },
    sourceReviewQueueItemId: input.sourceReviewQueueItem?.id ?? null,
    sourceReviewDecision: input.sourceReviewQueueItem?.review.decision ?? null,
    directGlobalPromotionAllowed: false,
    distinctUserCount: governanceEvidenceResult.distinctUserCount,
    conflictDetected: governanceEvidenceResult.conflictDetected,
    governanceChecks: {
      required: governanceEvidenceResult.required,
      replayDecision: governanceEvidenceResult.replayDecision,
      qualityGateDecision: input.qualityGate?.decision ?? governanceEvidenceResult.qualityGateDecision,
      positiveCases: governanceEvidenceResult.positiveCases,
      negativeCases: governanceEvidenceResult.negativeCases,
      ambiguousCases: governanceEvidenceResult.ambiguousCases,
      multiTurnCases: governanceEvidenceResult.multiTurnCases,
    },
    qualityGate: input.qualityGate ?? null,
    gradualPromotion: input.gradualPromotion ?? null,
    governanceVersion: WHATSAPP_LEARNING_GOVERNANCE_VERSION,
    privacy: buildPrivacy(createdAt),
    approvals: [],
    rejection: null,
    promotion: null,
    rollback: null,
  };

  nextCandidateId += 1;
  candidates.push(candidate);
  recordAudit({ createdAt, type: "candidate_created", candidateId: candidate.id, actor: "system", role: "system", action: candidate.action, status: candidate.status, justification: policy.description });
  void persistWhatsappLearningCandidate(candidate);
  return candidate;
}

export function recordWhatsappLearningCandidateFromReviewQueue(input: {
  item: WhatsappReviewQueueItem;
  kind: WhatsappLearningChangeKind;
  action: WhatsappLearningAction;
  title?: string;
  rationale?: string;
  payload?: Record<string, unknown>;
  createdAt?: Date;
}) {
  return recordWhatsappLearningCandidate({
    kind: input.kind,
    action: input.action,
    origin: `review-queue:${input.item.origin}`,
    scope: "global",
    title: input.title ?? input.item.title,
    rationale: input.rationale ?? input.item.reason,
    evidence: [{ source: "review_queue", reference: String(input.item.id), summary: `${input.item.type}:${input.item.fingerprint}` }],
    risk: input.item.impact === "critical" ? "critical" : input.item.impact === "high" ? "high" : "medium",
    expectedImpact: "Transformar item revisado em candidato controlado, sem promocao global direta.",
    rollbackPlan: "Remover candidato da versao futura e manter item original auditavel na fila de revisao.",
    version: input.item.conversion.convertedAt ? input.item.conversion.convertedAt : input.item.createdAt,
    metric: "Taxa de regressao e satisfacao apos promocao gradual.",
    payload: input.payload ?? input.item.conversion.payload ?? {},
    sourceReviewQueueItem: input.item,
    createdAt: input.createdAt,
  });
}

export function approveWhatsappLearningCandidate(input: {
  candidateId: number;
  reviewer: string;
  role: WhatsappLearningApprovalRole;
  justification: string;
  decidedAt?: Date;
}) {
  const candidate = candidates.find(item => item.id === input.candidateId);
  if (!candidate || candidate.status === "rejected" || candidate.status === "rolled_back") return null;
  const policy = getPolicy(candidate.action);
  const decidedAt = toIso(input.decidedAt);
  if (!policyAllowsRole(policy, input.role)) {
    recordAudit({ createdAt: decidedAt, type: "promotion_blocked", candidateId: candidate.id, actor: input.reviewer, role: input.role, action: candidate.action, status: candidate.status, justification: "Papel nao autorizado para aprovar esta mudanca de aprendizado." });
    return null;
  }

  if (!candidate.approvals.some(approval => approval.role === input.role && approval.reviewer === input.reviewer)) {
    candidate.approvals.push({ role: input.role, reviewer: input.reviewer, justification: input.justification, decidedAt });
  }
  candidate.status = approvalCount(candidate, policy) >= requiredApprovals(policy) ? "approved" : "needs_review";
  candidate.updatedAt = decidedAt;
  recordAudit({ createdAt: decidedAt, type: "approval_recorded", candidateId: candidate.id, actor: input.reviewer, role: input.role, action: candidate.action, status: candidate.status, justification: input.justification });
  void persistWhatsappLearningCandidate(candidate);
  return candidate;
}

export function rejectWhatsappLearningCandidate(input: {
  candidateId: number;
  reviewer: string;
  role: WhatsappLearningApprovalRole;
  justification: string;
  decidedAt?: Date;
}) {
  const candidate = candidates.find(item => item.id === input.candidateId);
  if (!candidate || candidate.status === "promoted" || candidate.status === "rolled_back") return null;
  const policy = getPolicy(candidate.action);
  const decidedAt = toIso(input.decidedAt);
  if (!policyAllowsRole(policy, input.role)) return null;
  candidate.status = "rejected";
  candidate.updatedAt = decidedAt;
  candidate.rejection = { role: input.role, reviewer: input.reviewer, justification: input.justification, decidedAt };
  recordAudit({ createdAt: decidedAt, type: "rejection_recorded", candidateId: candidate.id, actor: input.reviewer, role: input.role, action: candidate.action, status: candidate.status, justification: input.justification });
  void persistWhatsappLearningCandidate(candidate);
  return candidate;
}

export function evaluateWhatsappLearningPromotion(input: {
  candidateId: number;
  promotedBy?: string;
  role?: WhatsappLearningApprovalRole;
}): WhatsappLearningGovernanceDecision {
  const candidate = candidates.find(item => item.id === input.candidateId);
  if (!candidate) return { allowed: false, reason: "Candidato de aprendizado nao encontrado.", policy: getPolicy("direct_llm_mutation") };
  const policy = promotionPolicyFor(candidate);

  if (policy.level === "blocked" || candidate.action === "direct_llm_mutation") {
    return { allowed: false, reason: "Mudanca direta por LLM e bloqueada pela governanca.", policy };
  }
  if (candidate.status !== "approved" && requiredApprovals(policy) > 0) {
    return { allowed: false, reason: "Promocao exige aprovacao governada antes de ficar ativa.", policy };
  }
  if (candidate.governanceChecks.required && candidate.scope === "global" && candidate.distinctUserCount < 2) {
    return { allowed: false, reason: "Evidencia multiusuario exige pelo menos 2 usuarios distintos; repeticoes do mesmo usuario nao contam.", policy };
  }
  if (candidate.governanceChecks.required && candidate.conflictDetected) {
    return { allowed: false, reason: "Conflito material entre sinais bloqueia o candidato e exige revisao auditavel.", policy };
  }
  if (candidate.governanceChecks.required && candidate.governanceChecks.replayDecision !== "approve") {
    return { allowed: false, reason: "Replay/reprocessing sem decisao approve bloqueia a promocao global.", policy };
  }
  if (candidate.governanceChecks.required && (candidate.governanceChecks.positiveCases < 1 || candidate.governanceChecks.negativeCases < 1)) {
    return { allowed: false, reason: "Dataset positivo e negativo sao obrigatorios antes da promocao global.", policy };
  }
  if (candidate.governanceChecks.required && candidate.payload.ambiguousCasesApplicable === true && candidate.governanceChecks.ambiguousCases < 1) {
    return { allowed: false, reason: "Casos ambiguos aplicaveis ainda nao foram cobertos.", policy };
  }
  if (candidate.governanceChecks.required && candidate.payload.multiTurnApplicable === true && candidate.governanceChecks.multiTurnCases < 1) {
    return { allowed: false, reason: "Casos multi-turn aplicaveis ainda nao foram cobertos.", policy };
  }
  if (candidate.governanceChecks.required && candidate.qualityGate?.blockingFindings.length) {
    return { allowed: false, reason: "Quality gate canonico possui findings bloqueantes.", policy };
  }
  if (candidate.governanceChecks.required && candidate.scope === "global" && !candidate.gradualPromotion) {
    return { allowed: false, reason: "Candidato global sem avaliacao de promocao gradual nao pode avancar.", policy };
  }
  if (candidate.governanceChecks.required && candidate.gradualPromotion && !candidate.gradualPromotion.allowed) {
    return { allowed: false, reason: `Promocao gradual bloqueada: ${candidate.gradualPromotion.reason}`, policy };
  }
  if (candidate.governanceChecks.required && !["approve_shadow", "approve_canary", "approve_broad"].includes(candidate.governanceChecks.qualityGateDecision ?? "")) {
    return { allowed: false, reason: "Quality gates aplicaveis ainda nao aprovam o candidato.", policy };
  }
  if (input.role && !policyAllowsRole(policy, input.role)) {
    return { allowed: false, reason: "Papel sem permissao para promover esta mudanca.", policy };
  }
  const missing = missingPromotionMetadata(candidate, policy);
  if (missing.length > 0) {
    return { allowed: false, reason: `Promocao sem ${missing.join(", ")}.`, policy };
  }
  if (approvalCount(candidate, policy) < requiredApprovals(policy)) {
    return { allowed: false, reason: "Quantidade ou diversidade de aprovacoes insuficiente.", policy };
  }
  if (payloadContainsIdentifier(candidate.payload)) {
    return { allowed: false, reason: "Payload contem identificador direto e nao pode virar conhecimento global.", policy };
  }
  return { allowed: true, reason: "Mudanca atende a governanca de promocao.", policy };
}

export function promoteWhatsappLearningCandidate(input: {
  candidateId: number;
  promotedBy: string;
  role: WhatsappLearningApprovalRole;
  promotedAt?: Date;
}) {
  const candidate = candidates.find(item => item.id === input.candidateId);
  if (!candidate) return null;
  const promotedAt = toIso(input.promotedAt);
  const decision = evaluateWhatsappLearningPromotion({ candidateId: input.candidateId, promotedBy: input.promotedBy, role: input.role });
  if (!decision.allowed) {
    recordAudit({ createdAt: promotedAt, type: "promotion_blocked", candidateId: candidate.id, actor: input.promotedBy, role: input.role, action: candidate.action, status: candidate.status, justification: decision.reason });
    return null;
  }

  candidate.status = "promoted";
  candidate.updatedAt = promotedAt;
  candidate.promotion = {
    promotedAt,
    promotedBy: input.promotedBy,
    role: input.role,
    version: candidate.version ?? WHATSAPP_LEARNING_GOVERNANCE_VERSION,
    rollbackPlan: candidate.rollbackPlan ?? "Rollback nao informado.",
    metric: candidate.metric ?? "Metrica nao informada.",
  };
  recordAudit({ createdAt: promotedAt, type: "promotion_recorded", candidateId: candidate.id, actor: input.promotedBy, role: input.role, action: candidate.action, status: candidate.status, justification: decision.reason });
  void persistWhatsappLearningCandidate(candidate);
  return candidate;
}

export function rollbackWhatsappLearningCandidate(input: {
  candidateId: number;
  rolledBackBy: string;
  role: WhatsappLearningApprovalRole;
  reason: string;
  restoredVersion?: string | null;
  rolledBackAt?: Date;
}) {
  const candidate = candidates.find(item => item.id === input.candidateId);
  if (!candidate || candidate.status !== "promoted") return null;
  const policy = getPolicy("rollback_learning_change");
  if (!policyAllowsRole(policy, input.role)) return null;
  const rolledBackAt = toIso(input.rolledBackAt);
  candidate.status = "rolled_back";
  candidate.updatedAt = rolledBackAt;
  candidate.rollback = { rolledBackAt, rolledBackBy: input.rolledBackBy, role: input.role, reason: input.reason, restoredVersion: input.restoredVersion ?? null };
  recordAudit({ createdAt: rolledBackAt, type: "rollback_recorded", candidateId: candidate.id, actor: input.rolledBackBy, role: input.role, action: candidate.action, status: candidate.status, justification: input.reason });
  void persistWhatsappLearningCandidate(candidate);
  return candidate;
}

export function assertWhatsappDirectLearningMutationBlocked(input: {
  actor: "llm" | "system" | string;
  target: "prompt" | "schema" | "global_rule" | "global_memory" | "learning_autonomy";
  justification?: string;
  createdAt?: Date;
}) {
  const createdAt = toIso(input.createdAt);
  const reason = `Alteracao direta de ${input.target} exige candidato governado, evidencia, aprovacao e rollback.`;
  recordAudit({
    createdAt,
    type: "direct_change_blocked",
    candidateId: null,
    actor: input.actor,
    role: input.actor === "llm" ? "llm" : "system",
    action: "direct_llm_mutation",
    status: "blocked",
    justification: input.justification ? `${reason} ${input.justification}` : reason,
  });
  return { allowed: false, reason, policy: getPolicy("direct_llm_mutation") } satisfies WhatsappLearningGovernanceDecision;
}

export function listWhatsappLearningCandidates(filter: Partial<Pick<WhatsappLearningCandidate, "status" | "kind" | "action" | "scope">> = {}) {
  return candidates.filter(candidate => {
    if (filter.status && candidate.status !== filter.status) return false;
    if (filter.kind && candidate.kind !== filter.kind) return false;
    if (filter.action && candidate.action !== filter.action) return false;
    if (filter.scope && candidate.scope !== filter.scope) return false;
    return true;
  });
}

export function listWhatsappLearningAuditEvents(filter: Partial<Pick<WhatsappLearningAuditEvent, "candidateId" | "type">> = {}) {
  return auditEvents.filter(event => {
    if (filter.candidateId !== undefined && event.candidateId !== filter.candidateId) return false;
    if (filter.type && event.type !== filter.type) return false;
    return true;
  });
}

export async function persistWhatsappLearningCandidate(candidate: WhatsappLearningCandidate) {
  return persistWhatsappLearningArtifact({
    scope: "global",
    userId: null,
    kind: "learning_candidate",
    key: `candidate:${candidate.id}`,
    value: candidate,
    createdAt: new Date(candidate.createdAt),
  });
}

export async function persistWhatsappLearningAuditEvent(event: WhatsappLearningAuditEvent) {
  return persistWhatsappLearningArtifact({
    scope: "global",
    userId: null,
    kind: "learning_audit_event",
    key: `audit:${event.id}`,
    value: event,
    createdAt: new Date(event.createdAt),
  });
}

export async function recordWhatsappLearningCandidateDurably(input: RecordLearningCandidateInput) {
  const candidate = recordWhatsappLearningCandidate(input);
  const audit = listWhatsappLearningAuditEvents({ candidateId: candidate.id }).at(-1);
  const [persistedCandidate, persistedAudit] = await Promise.all([
    persistWhatsappLearningCandidate(candidate),
    audit ? persistWhatsappLearningAuditEvent(audit) : Promise.resolve(true),
  ]);
  return { candidate, persisted: Boolean(persistedCandidate && persistedAudit) };
}

export async function loadPersistedWhatsappLearningCandidates() {
  const artifacts = await listPersistedWhatsappLearningArtifacts<WhatsappLearningCandidate>({ scope: "global", kind: "learning_candidate" });
  if (artifacts === null) return null;
  return artifacts.map(artifact => artifact.value).filter(candidate => candidate && typeof candidate.id === "number");
}

export async function loadPersistedWhatsappLearningAuditEvents() {
  const artifacts = await listPersistedWhatsappLearningArtifacts<WhatsappLearningAuditEvent>({ scope: "global", kind: "learning_audit_event" });
  if (artifacts === null) return null;
  return artifacts.map(artifact => artifact.value).filter(event => event && typeof event.id === "number");
}

export async function hydrateWhatsappLearningGovernance() {
  const [persistedCandidates, persistedEvents] = await Promise.all([
    loadPersistedWhatsappLearningCandidates(),
    loadPersistedWhatsappLearningAuditEvents(),
  ]);
  if (persistedCandidates === null || persistedEvents === null) return { persisted: false as const, candidates: 0, auditEvents: 0 };

  const candidateIds = new Set(candidates.map(candidate => candidate.id));
  for (const candidate of persistedCandidates) {
    if (!candidateIds.has(candidate.id)) candidates.push(candidate);
  }
  const eventIds = new Set(auditEvents.map(event => event.id));
  for (const event of persistedEvents) {
    if (!eventIds.has(event.id)) auditEvents.push(event);
  }
  candidates.sort((a, b) => a.id - b.id);
  auditEvents.sort((a, b) => a.id - b.id);
  nextCandidateId = Math.max(nextCandidateId, (candidates.at(-1)?.id ?? 0) + 1);
  nextAuditId = Math.max(nextAuditId, (auditEvents.at(-1)?.id ?? 0) + 1);
  return { persisted: true as const, candidates: persistedCandidates.length, auditEvents: persistedEvents.length };
}

export function __resetWhatsappLearningGovernanceForTests() {
  candidates.length = 0;
  auditEvents.length = 0;
  nextCandidateId = 1;
  nextAuditId = 1;
}
