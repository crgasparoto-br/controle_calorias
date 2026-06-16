export const KNOWLEDGE_REVIEW_VERSION = "knowledge-review-v1";

export type ReviewableKnowledgeType =
  | "global_rule"
  | "nutrition_source"
  | "food_classification"
  | "global_alias"
  | "measurement_unit"
  | "household_measure"
  | "interpretation_heuristic"
  | "promoted_memory"
  | "reusable_preference";

export type ReviewableKnowledgeStatus = "active" | "needs_review" | "deprecated" | "replaced" | "disabled";

export type ReviewableKnowledgeScope = "global" | "tenant" | "user" | "professional" | "system";

export type KnowledgeReviewReason =
  | "age_expired"
  | "low_confidence"
  | "estimate_divergence"
  | "negative_feedback"
  | "drift_detected"
  | "source_replaced"
  | "rule_conflict"
  | "manual_review_requested"
  | "operational_risk";

export type KnowledgeReviewSignal = {
  type: "quality_metric" | "drift" | "nutrition_divergence" | "feedback" | "source_update" | "manual";
  reason: KnowledgeReviewReason;
  severity: "low" | "medium" | "high" | "critical";
  observedAt: string;
  detail: string;
  metricName?: string;
  value?: number;
  threshold?: number;
};

export type ReviewableKnowledgeItem = {
  id: string;
  type: ReviewableKnowledgeType;
  key: string;
  status: ReviewableKnowledgeStatus;
  scope: ReviewableKnowledgeScope;
  origin: string;
  version: string;
  createdAt: string;
  lastReviewedAt: string | null;
  approvedBy: string | null;
  confidence: number;
  appliesTo: string[];
  reason: string;
  replacedById: string | null;
  replacesId: string | null;
  metadata: Record<string, unknown>;
  reviewVersion: typeof KNOWLEDGE_REVIEW_VERSION;
};

export type KnowledgeReviewPolicy = {
  maxAgeDays?: number;
  minimumConfidence?: number;
  criticalStatuses?: ReviewableKnowledgeStatus[];
};

export type KnowledgeReviewAssessment = {
  item: ReviewableKnowledgeItem;
  status: ReviewableKnowledgeStatus;
  reasons: KnowledgeReviewReason[];
  signals: KnowledgeReviewSignal[];
  mustBlockActiveUse: boolean;
  canUseWithWarning: boolean;
  confidence: number;
  detail: string;
  reviewVersion: typeof KNOWLEDGE_REVIEW_VERSION;
};

export type KnowledgeReviewDecision = {
  itemId: string;
  status: ReviewableKnowledgeStatus;
  decidedAt: string;
  decidedBy: string;
  reason: string;
  replacementId?: string;
};

const DEFAULT_POLICY: Required<KnowledgeReviewPolicy> = {
  maxAgeDays: 180,
  minimumConfidence: 0.72,
  criticalStatuses: ["disabled", "deprecated", "replaced"],
};

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function daysBetween(startIso: string, endIso: string) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

function uniqueReasons(values: KnowledgeReviewReason[]) {
  return Array.from(new Set(values));
}

function highestSeverity(signals: KnowledgeReviewSignal[]) {
  const rank = { low: 1, medium: 2, high: 3, critical: 4 } as const;
  return signals.reduce((highest, signal) => Math.max(highest, rank[signal.severity]), 0);
}

export function createReviewableKnowledgeItem(input: {
  id: string;
  type: ReviewableKnowledgeType;
  key: string;
  scope: ReviewableKnowledgeScope;
  origin: string;
  version: string;
  createdAt: string;
  confidence: number;
  appliesTo: string[];
  reason: string;
  status?: ReviewableKnowledgeStatus;
  lastReviewedAt?: string | null;
  approvedBy?: string | null;
  replacesId?: string | null;
  metadata?: Record<string, unknown>;
}): ReviewableKnowledgeItem {
  return {
    id: input.id,
    type: input.type,
    key: input.key,
    status: input.status ?? "active",
    scope: input.scope,
    origin: input.origin,
    version: input.version,
    createdAt: input.createdAt,
    lastReviewedAt: input.lastReviewedAt ?? null,
    approvedBy: input.approvedBy ?? null,
    confidence: clampConfidence(input.confidence),
    appliesTo: Array.from(new Set(input.appliesTo.filter(Boolean))),
    reason: input.reason,
    replacedById: null,
    replacesId: input.replacesId ?? null,
    metadata: input.metadata ?? {},
    reviewVersion: KNOWLEDGE_REVIEW_VERSION,
  };
}

export function evaluateKnowledgeReviewNeed(params: {
  item: ReviewableKnowledgeItem;
  now?: string;
  policy?: KnowledgeReviewPolicy;
  signals?: KnowledgeReviewSignal[];
  replacementCandidateId?: string | null;
}): KnowledgeReviewAssessment {
  const policy = { ...DEFAULT_POLICY, ...params.policy };
  const now = params.now ?? new Date().toISOString();
  const signals = params.signals ?? [];
  const lastReviewReference = params.item.lastReviewedAt ?? params.item.createdAt;
  const itemAgeDays = daysBetween(lastReviewReference, now);
  const signalReasons = signals.map(signal => signal.reason);
  const reasons = uniqueReasons([
    ...(itemAgeDays > policy.maxAgeDays ? ["age_expired" as const] : []),
    ...(params.item.confidence < policy.minimumConfidence ? ["low_confidence" as const] : []),
    ...(params.replacementCandidateId ? ["source_replaced" as const] : []),
    ...signalReasons,
  ]);
  const severeSignal = highestSeverity(signals) >= 3;
  const mustBlockActiveUse = policy.criticalStatuses.includes(params.item.status)
    || params.item.status === "needs_review" && severeSignal
    || reasons.includes("operational_risk");
  const status: ReviewableKnowledgeStatus = mustBlockActiveUse
    ? params.item.status === "active" ? "needs_review" : params.item.status
    : reasons.length > 0
      ? "needs_review"
      : params.item.status;

  return {
    item: params.item,
    status,
    reasons,
    signals,
    mustBlockActiveUse,
    canUseWithWarning: status === "needs_review" && !mustBlockActiveUse,
    confidence: reasons.length > 0 ? Math.max(0, roundConfidence(params.item.confidence - 0.15)) : params.item.confidence,
    detail: reasons.length > 0
      ? "Item revisavel precisa de avaliacao antes de influenciar promocao global ou decisoes de alto risco."
      : "Item revisavel permanece valido para uso ativo.",
    reviewVersion: KNOWLEDGE_REVIEW_VERSION,
  };
}

function roundConfidence(value: number) {
  return Math.round(value * 100) / 100;
}

export function canUseKnowledgeAsActive(
  item: ReviewableKnowledgeItem,
  assessment: KnowledgeReviewAssessment = evaluateKnowledgeReviewNeed({ item }),
) {
  if (["disabled", "deprecated", "replaced"].includes(item.status)) return false;
  if (assessment.mustBlockActiveUse) return false;
  return item.status === "active" || assessment.canUseWithWarning;
}

export function replaceReviewableKnowledgeItem(params: {
  current: ReviewableKnowledgeItem;
  replacement: ReviewableKnowledgeItem;
  decidedAt: string;
  decidedBy: string;
  reason: string;
}) {
  const previous: ReviewableKnowledgeItem = {
    ...params.current,
    status: "replaced",
    replacedById: params.replacement.id,
    metadata: {
      ...params.current.metadata,
      replacedAt: params.decidedAt,
      replacedBy: params.decidedBy,
      replacementReason: params.reason,
    },
  };

  const next: ReviewableKnowledgeItem = {
    ...params.replacement,
    status: "active",
    replacesId: params.current.id,
    lastReviewedAt: params.decidedAt,
    approvedBy: params.decidedBy,
  };

  const decision: KnowledgeReviewDecision = {
    itemId: params.current.id,
    status: "replaced",
    decidedAt: params.decidedAt,
    decidedBy: params.decidedBy,
    reason: params.reason,
    replacementId: params.replacement.id,
  };

  return { previous, next, decision };
}

export function buildKnowledgeReviewSignal(input: KnowledgeReviewSignal): KnowledgeReviewSignal {
  return input;
}

export function selectActiveKnowledgeOrFallback(params: {
  candidates: ReviewableKnowledgeItem[];
  now?: string;
  policy?: KnowledgeReviewPolicy;
}) {
  for (const candidate of params.candidates) {
    const assessment = evaluateKnowledgeReviewNeed({ item: candidate, now: params.now, policy: params.policy });
    if (canUseKnowledgeAsActive(candidate, assessment)) {
      return {
        selected: candidate,
        assessment,
        fallbackUsed: false,
        reason: "active_reviewable_knowledge_available",
      };
    }
  }

  return {
    selected: null,
    assessment: null,
    fallbackUsed: true,
    reason: "no_active_reviewable_knowledge_available",
  };
}

export function buildKnowledgeUseAuditSnapshot(item: ReviewableKnowledgeItem) {
  return {
    itemId: item.id,
    type: item.type,
    key: item.key,
    origin: item.origin,
    version: item.version,
    statusAtUse: item.status,
    confidenceAtUse: item.confidence,
    reviewedAtUse: item.lastReviewedAt,
    replacedByIdAtUse: item.replacedById,
    reviewVersion: item.reviewVersion,
  };
}