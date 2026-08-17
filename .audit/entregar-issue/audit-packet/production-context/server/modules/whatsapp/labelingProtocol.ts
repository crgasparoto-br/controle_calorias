import { containsDirectIdentifier } from "../aiLearningPrivacy";
import type { WhatsappIntentName } from "./intentSchema";
import type { WhatsappMessageHistoryInputType } from "./messageHistory";

export const WHATSAPP_LABELING_PROTOCOL_VERSION = "whatsapp-labeling-protocol/v1";

export type WhatsappLabelingErrorReason =
  | "intent_error"
  | "entity_error"
  | "quantity_error"
  | "date_error"
  | "nutrition_source_error"
  | "memory_error"
  | "tool_error"
  | "transcription_error"
  | "legitimate_ambiguity"
  | "insufficient_data"
  | "out_of_scope"
  | "malicious_or_suspicious";
export type WhatsappLabelingDestination = "regression" | "negative_evaluation" | "multi_turn_regression" | "individual_memory" | "global_candidate" | "nutrition_curation" | "adjudication" | "privacy_rejected";
export type WhatsappLabelingReviewStatus = "approved" | "needs_adjudication" | "rejected";
export type WhatsappLabelingUseScope = "individual" | "global_candidate" | "golden_gate" | "metrics_only";
export type WhatsappLabelingAutonomy = "no_action" | "clarify" | "ask_confirmation" | "persist_allowed" | "review_required";
export type WhatsappLabelingSourceKind = "synthetic" | "anonymized_real" | "review_queue" | "feedback" | "support" | "offline_replay";
export type WhatsappLabelingRisk = "low" | "medium" | "high" | "critical";

export type WhatsappLabeledExpectedOutput = {
  intent: WhatsappIntentName | "unknown";
  action: string;
  entities: Record<string, unknown>;
  quantity?: { value: number; unit: string } | null;
  date?: string | null;
  targetMeal?: string | null;
  nutritionSource?: string | null;
  autonomy: WhatsappLabelingAutonomy;
  persistenceAllowed: boolean;
  decisionReason: string;
  errorReason?: WhatsappLabelingErrorReason | null;
};

export type WhatsappLabelingReview = {
  primaryReviewer: string;
  reviewedAt: string;
  secondaryReviewer?: string | null;
  adjudicator?: string | null;
  adjudicatedAt?: string | null;
  status: WhatsappLabelingReviewStatus;
  justification: string;
  disagreementReason?: string | null;
};

export type WhatsappLabeledExample = {
  id: string;
  sourceKind: WhatsappLabelingSourceKind;
  originReference: string;
  input: string;
  inputType: WhatsappMessageHistoryInputType;
  schemaVersion: string;
  risk: WhatsappLabelingRisk;
  useScope: WhatsappLabelingUseScope;
  expected: WhatsappLabeledExpectedOutput;
  review: WhatsappLabelingReview;
  anonymization: {
    applied: boolean;
    directIdentifierPresent: boolean;
    retentionScope: "none" | "short_term" | "dataset" | "audit_only";
    notes: string;
  };
  multiTurn?: {
    initialState: Record<string, unknown>;
    messages: Array<{ input: string; expectedAction: string; expectedPendingState?: Record<string, unknown> }>;
    expectedFinalState: Record<string, unknown>;
  } | null;
  metadata?: Record<string, unknown>;
};

export type WhatsappLabelingValidationResult = {
  accepted: boolean;
  destination: WhatsappLabelingDestination;
  requiresAdjudication: boolean;
  canBeBlockingGolden: boolean;
  privacyAccepted: boolean;
  missingFields: string[];
  reasons: string[];
  policyVersion: typeof WHATSAPP_LABELING_PROTOCOL_VERSION;
};

export const WHATSAPP_LABELING_GUIDELINES = {
  requiredExpectedFields: ["intent", "action", "entities", "autonomy", "persistenceAllowed", "decisionReason"],
  errorReasons: [
    "intent_error",
    "entity_error",
    "quantity_error",
    "date_error",
    "nutrition_source_error",
    "memory_error",
    "tool_error",
    "transcription_error",
    "legitimate_ambiguity",
    "insufficient_data",
    "out_of_scope",
    "malicious_or_suspicious",
  ] satisfies WhatsappLabelingErrorReason[],
  noActionRequiresNoPersistence: true,
  highImpactRequiresSecondReview: true,
  realExamplesRequireAnonymization: true,
  integrations: {
    regressionDataset: "#413",
    conversationRegression: "#428",
    negativeEvaluation: "#441",
    reviewQueue: "#414",
    feedbackLoop: "#430",
    privacy: "#432",
    governance: "#443",
    security: "#444",
    confidenceCalibration: "#445",
    qualityGates: "#446",
  },
  version: WHATSAPP_LABELING_PROTOCOL_VERSION,
} as const;

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim());
}

function missingBaseFields(example: WhatsappLabeledExample) {
  const missing: string[] = [];
  if (!hasText(example.id)) missing.push("id");
  if (!hasText(example.originReference)) missing.push("originReference");
  if (!hasText(example.input)) missing.push("input");
  if (!hasText(example.schemaVersion)) missing.push("schemaVersion");
  if (!hasText(example.review.primaryReviewer)) missing.push("review.primaryReviewer");
  if (!hasText(example.review.reviewedAt)) missing.push("review.reviewedAt");
  if (!hasText(example.review.justification)) missing.push("review.justification");
  if (!hasText(example.expected.action)) missing.push("expected.action");
  if (!hasText(example.expected.decisionReason)) missing.push("expected.decisionReason");
  if (!example.expected.entities || typeof example.expected.entities !== "object") missing.push("expected.entities");
  return missing;
}

function missingMultiTurnFields(example: WhatsappLabeledExample) {
  if (!example.multiTurn) return [];
  const missing: string[] = [];
  if (!example.multiTurn.initialState) missing.push("multiTurn.initialState");
  if (!example.multiTurn.expectedFinalState) missing.push("multiTurn.expectedFinalState");
  if (example.multiTurn.messages.length === 0) missing.push("multiTurn.messages");
  return missing;
}

function privacyAccepted(example: WhatsappLabeledExample) {
  if (example.anonymization.directIdentifierPresent) return false;
  if (containsDirectIdentifier(example.input)) return false;
  if (example.sourceKind === "anonymized_real" && !example.anonymization.applied) return false;
  return true;
}

function hasAdjudication(example: WhatsappLabeledExample) {
  return hasText(example.review.secondaryReviewer) || hasText(example.review.adjudicator);
}

function requiresAdjudication(example: WhatsappLabeledExample) {
  if (example.review.status === "needs_adjudication") return true;
  if (example.expected.errorReason === "legitimate_ambiguity") return !hasAdjudication(example);
  if (example.risk === "high" || example.risk === "critical") return !hasAdjudication(example);
  if (hasText(example.review.disagreementReason)) return !hasText(example.review.adjudicator);
  return false;
}

export function classifyWhatsappLabeledExampleDestination(example: WhatsappLabeledExample): WhatsappLabelingDestination {
  if (!privacyAccepted(example)) return "privacy_rejected";
  if (requiresAdjudication(example)) return "adjudication";
  if (example.multiTurn) return "multi_turn_regression";
  if (!example.expected.persistenceAllowed || example.expected.autonomy === "no_action") return "negative_evaluation";
  if (example.expected.errorReason === "nutrition_source_error") return "nutrition_curation";
  if (example.useScope === "individual") return "individual_memory";
  if (example.useScope === "global_candidate") return "global_candidate";
  return "regression";
}

export function validateWhatsappLabeledExample(example: WhatsappLabeledExample): WhatsappLabelingValidationResult {
  const missingFields = [...missingBaseFields(example), ...missingMultiTurnFields(example)];
  const reasons: string[] = [];
  const privacyOk = privacyAccepted(example);
  const needsAdjudication = requiresAdjudication(example);

  if (!privacyOk) reasons.push("Exemplo contem identificador direto ou mensagem real sem anonimizacao suficiente.");
  if (needsAdjudication) reasons.push("Exemplo ambiguo, divergente ou de alto impacto exige segunda revisao ou adjudicacao.");
  if (example.expected.autonomy === "no_action" && example.expected.persistenceAllowed) {
    missingFields.push("expected.persistenceAllowed=false");
    reasons.push("Caso de nao acao nao pode permitir persistencia.");
  }
  if (example.expected.persistenceAllowed === false && !example.expected.errorReason) {
    missingFields.push("expected.errorReason");
    reasons.push("Caso negativo precisa declarar motivo padronizado de nao acao ou erro.");
  }
  if (example.review.status === "rejected") reasons.push("Revisao marcou exemplo como rejeitado.");

  const destination = classifyWhatsappLabeledExampleDestination(example);
  const accepted = missingFields.length === 0 && privacyOk && !needsAdjudication && example.review.status === "approved";
  const canBeBlockingGolden = accepted && example.useScope === "golden_gate" && destination !== "privacy_rejected" && destination !== "adjudication";

  return {
    accepted,
    destination,
    requiresAdjudication: needsAdjudication,
    canBeBlockingGolden,
    privacyAccepted: privacyOk,
    missingFields,
    reasons,
    policyVersion: WHATSAPP_LABELING_PROTOCOL_VERSION,
  };
}
