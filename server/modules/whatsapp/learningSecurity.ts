import {
  buildAiLearningPrivacyRecord,
  containsDirectIdentifier,
  type AiLearningPrivacyRecord,
} from "../aiLearningPrivacy";
import type { WhatsappFeedbackKind } from "./feedbackLoop";
import type { WhatsappLearningAction, WhatsappLearningChangeKind } from "./learningGovernance";

export const WHATSAPP_LEARNING_SECURITY_VERSION = "whatsapp-learning-security/v1";

export type WhatsappLearningSignalClassification = "trusted" | "suspicious" | "quarantined" | "blocked";
export type WhatsappLearningSignalState = "allowed" | "reduced_confidence" | "quarantined" | "blocked";
export type WhatsappLearningEvidenceSource = "feedback" | "message_history" | "review_queue" | "offline_replay" | "curation" | "metrics" | "manual";
export type WhatsappLearningRiskSignal =
  | "single_user_global_rule"
  | "low_diversity"
  | "insufficient_recurrence"
  | "explicit_global_manipulation"
  | "prompt_or_autonomy_manipulation"
  | "contradictory_corrections"
  | "spam_repetition"
  | "sensitive_or_identifiable_data"
  | "nutrition_impossible"
  | "high_reversal_user"
  | "conflicts_with_trusted_rule";

export type WhatsappLearningSecurityPolicy = {
  minDistinctUsersForGlobalCandidate: number;
  minEventsForGlobalCandidate: number;
  minTrustedEvidenceForPromotion: number;
  maxUserReversalRateBeforePenalty: number;
  maxRepeatedEqualSignalsPerUser: number;
  quarantineReviewRequired: true;
  directGlobalPromotionAllowed: false;
  version: typeof WHATSAPP_LEARNING_SECURITY_VERSION;
  integrations: {
    feedbackLoop: "#430";
    reviewQueue: "#414";
    driftMetrics: "#431";
    promptInjectionGuard: "#437";
    gradualPromotion: "#442";
    governance: "#443";
  };
};

export type WhatsappLearningEvidence = {
  source: WhatsappLearningEvidenceSource;
  userId?: number | null;
  reference: string;
  summary: string;
  trusted?: boolean;
  curated?: boolean;
};

export type WhatsappLearningSignalAssessment = {
  classification: WhatsappLearningSignalClassification;
  state: WhatsappLearningSignalState;
  confidenceWeight: number;
  riskSignals: WhatsappLearningRiskSignal[];
  reasons: string[];
  globalPromotionAllowed: false;
  reviewQueueRecommended: boolean;
  quarantineId: number | null;
  proposedScope: "individual" | "global" | "system";
  privacy: AiLearningPrivacyRecord;
  policyVersion: typeof WHATSAPP_LEARNING_SECURITY_VERSION;
};

export type WhatsappLearningQuarantineEntry = {
  id: number;
  createdAt: string;
  origin: string;
  userId: number | null;
  action: WhatsappLearningAction | null;
  kind: WhatsappLearningChangeKind | null;
  classification: WhatsappLearningSignalClassification;
  riskSignals: WhatsappLearningRiskSignal[];
  reasons: string[];
  confidenceWeight: number;
  evidence: WhatsappLearningEvidence[];
  payload: Record<string, unknown>;
  policyVersion: typeof WHATSAPP_LEARNING_SECURITY_VERSION;
  privacy: AiLearningPrivacyRecord;
};

type AssessLearningSignalInput = {
  origin: string;
  userId?: number | null;
  text?: string | null;
  feedbackKind?: WhatsappFeedbackKind | null;
  action?: WhatsappLearningAction | null;
  kind?: WhatsappLearningChangeKind | null;
  proposedScope: "individual" | "global" | "system";
  evidence?: WhatsappLearningEvidence[];
  payload?: Record<string, unknown>;
  userStats?: {
    reversalRate?: number;
    repeatedEqualSignals?: number;
    contradictoryCorrections?: number;
  };
  existingTrustedRuleConflict?: boolean;
  nutritionImpossible?: boolean;
  createdAt?: Date;
};

type EvaluateGlobalEvidenceInput = {
  evidence: WhatsappLearningEvidence[];
  hasConflicts?: boolean;
  containsSensitiveData?: boolean;
  offlineReplayPassed?: boolean;
  curatedApprovalCount?: number;
};

export const WHATSAPP_LEARNING_SECURITY_POLICY: WhatsappLearningSecurityPolicy = {
  minDistinctUsersForGlobalCandidate: 2,
  minEventsForGlobalCandidate: 2,
  minTrustedEvidenceForPromotion: 2,
  maxUserReversalRateBeforePenalty: 0.35,
  maxRepeatedEqualSignalsPerUser: 3,
  quarantineReviewRequired: true,
  directGlobalPromotionAllowed: false,
  version: WHATSAPP_LEARNING_SECURITY_VERSION,
  integrations: {
    feedbackLoop: "#430",
    reviewQueue: "#414",
    driftMetrics: "#431",
    promptInjectionGuard: "#437",
    gradualPromotion: "#442",
    governance: "#443",
  },
};

const quarantineEntries: WhatsappLearningQuarantineEntry[] = [];
let nextQuarantineId = 1;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildPrivacy(createdAt: string) {
  return buildAiLearningPrivacyRecord({
    kind: "candidate_rule",
    purpose: "global_learning",
    origin: "whatsapp-learning-security",
    createdAt,
    scope: "global",
  });
}

function hasGlobalManipulation(text: string) {
  const normalized = normalize(text);
  return /\b(?:ensine|aprenda|grave|salve|registre)\b/.test(normalized)
    && /\b(?:todos usuarios|todos os usuarios|todo mundo|global|base global|regra global)\b/.test(normalized);
}

function hasPromptOrAutonomyManipulation(text: string) {
  const normalized = normalize(text);
  return /\b(?:prompt|sistema|developer|autonomia|ferramenta|tool|schema|politica|ignore as regras|ignorar regras)\b/.test(normalized);
}

function isPersonalAlias(input: AssessLearningSignalInput) {
  if (input.proposedScope !== "individual") return false;
  if (input.feedbackKind !== "personal_alias" && input.feedbackKind !== "preference" && input.feedbackKind !== "recurring_instruction") return false;
  return !hasPromptOrAutonomyManipulation(input.text ?? "") && !hasGlobalManipulation(input.text ?? "");
}

function distinctUsers(evidence: WhatsappLearningEvidence[]) {
  return new Set(evidence.map(item => item.userId).filter((userId): userId is number => typeof userId === "number")).size;
}

function trustedEvidenceCount(evidence: WhatsappLearningEvidence[]) {
  return evidence.filter(item => item.trusted || item.curated || item.source === "curation" || item.source === "offline_replay").length;
}

function hasSensitivePayload(input: AssessLearningSignalInput) {
  return containsDirectIdentifier(`${input.text ?? ""} ${JSON.stringify(input.payload ?? {})}`);
}

function stateFromRisk(riskSignals: WhatsappLearningRiskSignal[], personalAlias: boolean): Pick<WhatsappLearningSignalAssessment, "classification" | "state" | "confidenceWeight" | "reviewQueueRecommended"> {
  if (riskSignals.includes("prompt_or_autonomy_manipulation") || riskSignals.includes("explicit_global_manipulation")) {
    return { classification: "blocked", state: "blocked", confidenceWeight: 0, reviewQueueRecommended: true };
  }
  if (riskSignals.includes("sensitive_or_identifiable_data") || riskSignals.includes("conflicts_with_trusted_rule")) {
    return { classification: "quarantined", state: "quarantined", confidenceWeight: 0.1, reviewQueueRecommended: true };
  }
  if (riskSignals.length > 0) {
    return { classification: personalAlias ? "trusted" : "suspicious", state: personalAlias ? "allowed" : "reduced_confidence", confidenceWeight: personalAlias ? 0.8 : 0.35, reviewQueueRecommended: !personalAlias };
  }
  return { classification: "trusted", state: "allowed", confidenceWeight: 1, reviewQueueRecommended: false };
}

function buildReasons(riskSignals: WhatsappLearningRiskSignal[]) {
  const reasons: Record<WhatsappLearningRiskSignal, string> = {
    single_user_global_rule: "Sinal global veio de um unico usuario.",
    low_diversity: "Evidencia nao tem diversidade minima de usuarios.",
    insufficient_recurrence: "Evidencia nao tem recorrencia minima.",
    explicit_global_manipulation: "Mensagem tenta ensinar ou impor regra global indevida.",
    prompt_or_autonomy_manipulation: "Mensagem tenta alterar prompt, schema, ferramenta, politica ou autonomia.",
    contradictory_corrections: "Correcoes repetidas e contraditorias reduzem confianca.",
    spam_repetition: "Repeticao suspeita de sinais pelo mesmo usuario.",
    sensitive_or_identifiable_data: "Sinal contem dado sensivel ou identificavel e nao pode alimentar conhecimento global.",
    nutrition_impossible: "Correcao nutricional parece impossivel ou fora da distribuicao esperada.",
    high_reversal_user: "Usuario tem historico recente de alta reversao ou inconsistencia.",
    conflicts_with_trusted_rule: "Candidato conflita com regra confiavel existente.",
  };
  return riskSignals.map(signal => reasons[signal]);
}

function quarantine(input: AssessLearningSignalInput, assessment: Omit<WhatsappLearningSignalAssessment, "quarantineId">, createdAt: string) {
  if (assessment.state !== "quarantined" && assessment.state !== "blocked") return null;
  const entry: WhatsappLearningQuarantineEntry = {
    id: nextQuarantineId,
    createdAt,
    origin: input.origin,
    userId: input.userId ?? null,
    action: input.action ?? null,
    kind: input.kind ?? null,
    classification: assessment.classification,
    riskSignals: assessment.riskSignals,
    reasons: assessment.reasons,
    confidenceWeight: assessment.confidenceWeight,
    evidence: input.evidence ?? [],
    payload: input.payload ?? {},
    policyVersion: WHATSAPP_LEARNING_SECURITY_VERSION,
    privacy: assessment.privacy,
  };
  nextQuarantineId += 1;
  quarantineEntries.push(entry);
  return entry.id;
}

export function assessWhatsappLearningSignal(input: AssessLearningSignalInput): WhatsappLearningSignalAssessment {
  const createdAt = toIso(input.createdAt);
  const evidence = input.evidence ?? [];
  const riskSignals = new Set<WhatsappLearningRiskSignal>();
  const personalAlias = isPersonalAlias(input);
  const text = input.text ?? "";

  if (hasPromptOrAutonomyManipulation(text)) riskSignals.add("prompt_or_autonomy_manipulation");
  if (hasGlobalManipulation(text)) riskSignals.add("explicit_global_manipulation");
  if (hasSensitivePayload(input) && input.proposedScope !== "individual") riskSignals.add("sensitive_or_identifiable_data");
  if (input.existingTrustedRuleConflict) riskSignals.add("conflicts_with_trusted_rule");
  if (input.nutritionImpossible) riskSignals.add("nutrition_impossible");
  if ((input.userStats?.contradictoryCorrections ?? 0) >= 2) riskSignals.add("contradictory_corrections");
  if ((input.userStats?.repeatedEqualSignals ?? 0) > WHATSAPP_LEARNING_SECURITY_POLICY.maxRepeatedEqualSignalsPerUser) riskSignals.add("spam_repetition");
  if ((input.userStats?.reversalRate ?? 0) > WHATSAPP_LEARNING_SECURITY_POLICY.maxUserReversalRateBeforePenalty) riskSignals.add("high_reversal_user");

  if (input.proposedScope === "global" && !personalAlias) {
    if (distinctUsers(evidence) < WHATSAPP_LEARNING_SECURITY_POLICY.minDistinctUsersForGlobalCandidate) riskSignals.add("low_diversity");
    if (evidence.length < WHATSAPP_LEARNING_SECURITY_POLICY.minEventsForGlobalCandidate) riskSignals.add("insufficient_recurrence");
    if (distinctUsers(evidence) <= 1) riskSignals.add("single_user_global_rule");
  }

  const riskList = [...riskSignals];
  const base = stateFromRisk(riskList, personalAlias);
  const privacy = buildPrivacy(createdAt);
  const withoutQuarantineId = {
    ...base,
    riskSignals: riskList,
    reasons: buildReasons(riskList),
    globalPromotionAllowed: false,
    proposedScope: input.proposedScope,
    privacy,
    policyVersion: WHATSAPP_LEARNING_SECURITY_VERSION,
  } satisfies Omit<WhatsappLearningSignalAssessment, "quarantineId">;
  const quarantineId = quarantine(input, withoutQuarantineId, createdAt);
  return { ...withoutQuarantineId, quarantineId };
}

export function evaluateWhatsappGlobalLearningEvidence(input: EvaluateGlobalEvidenceInput) {
  const evidence = input.evidence;
  const reasons: string[] = [];
  if (distinctUsers(evidence) < WHATSAPP_LEARNING_SECURITY_POLICY.minDistinctUsersForGlobalCandidate) reasons.push("diversidade de usuarios insuficiente");
  if (evidence.length < WHATSAPP_LEARNING_SECURITY_POLICY.minEventsForGlobalCandidate) reasons.push("recorrencia insuficiente");
  if (trustedEvidenceCount(evidence) + (input.curatedApprovalCount ?? 0) < WHATSAPP_LEARNING_SECURITY_POLICY.minTrustedEvidenceForPromotion) reasons.push("evidencia confiavel insuficiente");
  if (input.hasConflicts) reasons.push("conflito com regra confiavel existente");
  if (input.containsSensitiveData) reasons.push("dados sensiveis ou identificaveis no candidato");
  if (input.offlineReplayPassed === false) reasons.push("replay offline nao passou");

  return {
    allowed: reasons.length === 0,
    reasons,
    globalPromotionAllowed: false as const,
    requiredDistinctUsers: WHATSAPP_LEARNING_SECURITY_POLICY.minDistinctUsersForGlobalCandidate,
    requiredEvents: WHATSAPP_LEARNING_SECURITY_POLICY.minEventsForGlobalCandidate,
    policyVersion: WHATSAPP_LEARNING_SECURITY_VERSION,
  };
}

export function listWhatsappLearningQuarantine(filter: Partial<Pick<WhatsappLearningQuarantineEntry, "classification" | "userId" | "action">> = {}) {
  return quarantineEntries.filter(entry => {
    if (filter.classification && entry.classification !== filter.classification) return false;
    if (filter.userId !== undefined && entry.userId !== filter.userId) return false;
    if (filter.action && entry.action !== filter.action) return false;
    return true;
  });
}

export function __resetWhatsappLearningSecurityForTests() {
  quarantineEntries.length = 0;
  nextQuarantineId = 1;
}
