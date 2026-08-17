import { containsDirectIdentifier } from "../aiLearningPrivacy";
import type { WhatsappCalibrationResult, WhatsappCalibrationVersionContext } from "./confidenceCalibration";
import type { WhatsappIntentName } from "./intentSchema";

export const WHATSAPP_DECISION_EXPLAINABILITY_VERSION = "whatsapp-decision-explainability/v1";

export type WhatsappDecisionOutcome = "saved" | "clarification_requested" | "answered_without_saving" | "sent_to_review" | "blocked" | "fallback";
export type WhatsappDecisionAudience = "support" | "admin" | "curator" | "technical";
export type WhatsappDecisionFactorKind = "deterministic_rule" | "llm" | "individual_memory" | "global_rule" | "nutrition_source" | "tool" | "pending_context" | "confidence" | "autonomy" | "backend_validation" | "quality_gate";

export type WhatsappDecisionFactor = {
  kind: WhatsappDecisionFactorKind;
  label: string;
  summary: string;
  version?: string | null;
  weight: "low" | "medium" | "high" | "blocking";
};

export type WhatsappRejectedAlternative = {
  label: string;
  rejectedBecause: string;
  riskAvoided: string;
};

export type WhatsappDecisionExplanationInput = {
  messageId: string;
  decisionId: string;
  createdAt?: Date;
  inputExcerpt?: string | null;
  intent: WhatsappIntentName | "unknown";
  rawConfidence: number;
  calibrated?: Pick<WhatsappCalibrationResult, "calibratedConfidence" | "threshold" | "decision" | "reason"> | null;
  autonomy: "automatic" | "confirmation_required" | "clarification_required" | "review_required" | "blocked";
  outcome: WhatsappDecisionOutcome;
  operationalReason: string;
  factors: WhatsappDecisionFactor[];
  rejectedAlternatives?: WhatsappRejectedAlternative[];
  versions: WhatsappCalibrationVersionContext & {
    ruleVersion?: string;
    nutritionSourceVersion?: string;
    toolVersion?: string;
    qualityGateVersion?: string;
  };
  audience?: WhatsappDecisionAudience;
};

export type WhatsappDecisionExplanation = {
  id: number;
  messageId: string;
  decisionId: string;
  createdAt: string;
  summary: string;
  audience: WhatsappDecisionAudience;
  inputExcerpt: string | null;
  intent: WhatsappIntentName | "unknown";
  rawConfidence: number;
  calibratedConfidence: number | null;
  threshold: number | null;
  autonomy: WhatsappDecisionExplanationInput["autonomy"];
  outcome: WhatsappDecisionOutcome;
  operationalReason: string;
  factors: WhatsappDecisionFactor[];
  rejectedAlternatives: WhatsappRejectedAlternative[];
  versions: WhatsappDecisionExplanationInput["versions"];
  privacy: {
    minimized: true;
    directIdentifierRemoved: boolean;
    rawMessageStored: false;
  };
  integrations: typeof WHATSAPP_DECISION_EXPLAINABILITY_POLICY.integrations;
  policyVersion: typeof WHATSAPP_DECISION_EXPLAINABILITY_VERSION;
};

const explanations: WhatsappDecisionExplanation[] = [];
let nextExplanationId = 1;

export const WHATSAPP_DECISION_EXPLAINABILITY_POLICY = {
  summary: "Explicacao operacional curta, vinculada a decisao original, sem substituir logs tecnicos ou validacao de backend.",
  maxExcerptLength: 80,
  rawMessageStored: false,
  audiences: ["support", "admin", "curator", "technical"] satisfies WhatsappDecisionAudience[],
  integrations: {
    initialProtection: "#410",
    structuredHistory: "#411",
    backendValidation: "#412",
    metrics: "#417",
    regressionManagement: "#433",
    structuredPrompt: "#438",
    observability: "#440",
    governance: "#443",
    confidenceCalibration: "#445",
    qualityGates: "#446",
  },
  version: WHATSAPP_DECISION_EXPLAINABILITY_VERSION,
} as const;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function minimizeExcerpt(input: string | null | undefined) {
  if (!input) return { value: null, directIdentifierRemoved: false };
  if (containsDirectIdentifier(input)) return { value: "[conteudo minimizado por privacidade]", directIdentifierRemoved: true };
  const trimmed = input.trim().replace(/\s+/g, " ");
  const max = WHATSAPP_DECISION_EXPLAINABILITY_POLICY.maxExcerptLength;
  return { value: trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed, directIdentifierRemoved: false };
}

function summaryFor(input: WhatsappDecisionExplanationInput) {
  const calibrated = input.calibrated ? `, confianca calibrada ${input.calibrated.calibratedConfidence}` : "";
  return `${input.outcome}: intencao ${input.intent} com confianca bruta ${clamp(input.rawConfidence)}${calibrated}. ${input.operationalReason}`;
}

export function recordWhatsappDecisionExplanation(input: WhatsappDecisionExplanationInput): WhatsappDecisionExplanation {
  const excerpt = minimizeExcerpt(input.inputExcerpt);
  const explanation: WhatsappDecisionExplanation = {
    id: nextExplanationId,
    messageId: input.messageId,
    decisionId: input.decisionId,
    createdAt: toIso(input.createdAt),
    summary: summaryFor(input),
    audience: input.audience ?? "support",
    inputExcerpt: excerpt.value,
    intent: input.intent,
    rawConfidence: clamp(input.rawConfidence),
    calibratedConfidence: input.calibrated?.calibratedConfidence ?? null,
    threshold: input.calibrated?.threshold ?? null,
    autonomy: input.autonomy,
    outcome: input.outcome,
    operationalReason: input.operationalReason,
    factors: input.factors,
    rejectedAlternatives: input.rejectedAlternatives ?? [],
    versions: input.versions,
    privacy: {
      minimized: true,
      directIdentifierRemoved: excerpt.directIdentifierRemoved,
      rawMessageStored: false,
    },
    integrations: WHATSAPP_DECISION_EXPLAINABILITY_POLICY.integrations,
    policyVersion: WHATSAPP_DECISION_EXPLAINABILITY_VERSION,
  };
  nextExplanationId += 1;
  explanations.push(explanation);
  return explanation;
}

export function listWhatsappDecisionExplanations(filter: Partial<Pick<WhatsappDecisionExplanation, "messageId" | "decisionId" | "outcome">> = {}) {
  return explanations.filter(explanation => {
    if (filter.messageId && explanation.messageId !== filter.messageId) return false;
    if (filter.decisionId && explanation.decisionId !== filter.decisionId) return false;
    if (filter.outcome && explanation.outcome !== filter.outcome) return false;
    return true;
  });
}

export function __resetWhatsappDecisionExplainabilityForTests() {
  explanations.length = 0;
  nextExplanationId = 1;
}
