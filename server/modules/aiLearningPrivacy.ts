import { redactSensitiveText } from "../privacy";

export const AI_LEARNING_PRIVACY_POLICY_VERSION = "ai-learning-privacy-v1";

export type AiLearningDataKind =
  | "raw_message"
  | "anonymized_message"
  | "structured_decision"
  | "transcript"
  | "media_reference"
  | "candidate_rule"
  | "audit_event";

export type AiLearningPurpose = "operation" | "audit" | "individual_learning" | "global_learning";

export type AiLearningRetentionClass = "ephemeral" | "operational" | "audit" | "learning_candidate" | "global_aggregate";

export type AiLearningPrivacyRecord = {
  kind: AiLearningDataKind;
  purpose: AiLearningPurpose;
  retentionClass: AiLearningRetentionClass;
  retentionDays: number;
  rawTextAllowed: boolean;
  anonymizationRequired: boolean;
  globalPromotionAllowed: boolean;
  origin: string;
  scope: "user" | "system" | "global";
  anonymizationApplied: string[];
  expiresAt: string | null;
  policyVersion: typeof AI_LEARNING_PRIVACY_POLICY_VERSION;
};

export type SanitizedLearningSample = {
  originalKind: AiLearningDataKind;
  purpose: AiLearningPurpose;
  text: string | null;
  structured: Record<string, unknown> | null;
  metadata: AiLearningPrivacyRecord;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /\+?\d[\d\s().-]{8,}\d/;
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/;
const ADDRESS_HINT_PATTERN = /\b(rua|avenida|av\.?|alameda|travessa|rodovia)\s+[\p{L}\d\s.-]{3,}/iu;

const RETENTION_DAYS: Record<AiLearningRetentionClass, number> = {
  ephemeral: 7,
  operational: 30,
  audit: 365,
  learning_candidate: 180,
  global_aggregate: 730,
};

function addDays(iso: string, days: number) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function containsDirectIdentifier(value: string) {
  return EMAIL_PATTERN.test(value)
    || PHONE_PATTERN.test(value)
    || CPF_PATTERN.test(value)
    || ADDRESS_HINT_PATTERN.test(value);
}

export function anonymizeLearningText(value: string) {
  return redactSensitiveText(value)
    .replace(CPF_PATTERN, "[document_redacted]")
    .replace(ADDRESS_HINT_PATTERN, "[address_redacted]");
}

export function buildAiLearningPrivacyRecord(input: {
  kind: AiLearningDataKind;
  purpose: AiLearningPurpose;
  origin: string;
  createdAt: string;
  scope?: "user" | "system" | "global";
  anonymizationApplied?: string[];
}): AiLearningPrivacyRecord {
  const globalPurpose = input.purpose === "global_learning";
  const rawTextAllowed = input.purpose === "operation" || input.purpose === "audit";
  const anonymizationRequired = globalPurpose
    || input.purpose === "individual_learning"
    || input.kind === "transcript"
    || input.kind === "raw_message";
  const retentionClass: AiLearningRetentionClass = globalPurpose
    ? "global_aggregate"
    : input.purpose === "individual_learning"
      ? "learning_candidate"
      : input.purpose === "audit"
        ? "audit"
        : input.kind === "media_reference"
          ? "ephemeral"
          : "operational";
  const retentionDays = RETENTION_DAYS[retentionClass];

  return {
    kind: input.kind,
    purpose: input.purpose,
    retentionClass,
    retentionDays,
    rawTextAllowed,
    anonymizationRequired,
    globalPromotionAllowed: globalPurpose && input.kind !== "raw_message" && input.kind !== "media_reference",
    origin: input.origin,
    scope: input.scope ?? (globalPurpose ? "global" : "user"),
    anonymizationApplied: input.anonymizationApplied ?? [],
    expiresAt: retentionClass === "global_aggregate" ? null : addDays(input.createdAt, retentionDays),
    policyVersion: AI_LEARNING_PRIVACY_POLICY_VERSION,
  };
}

export function sanitizeSampleForLearning(input: {
  kind: AiLearningDataKind;
  purpose: AiLearningPurpose;
  text?: string | null;
  structured?: Record<string, unknown> | null;
  origin: string;
  createdAt: string;
}): SanitizedLearningSample {
  const anonymized = input.text ? anonymizeLearningText(input.text) : null;
  const anonymizationApplied = input.text && anonymized !== input.text ? ["direct_identifier_redaction"] : [];
  const metadata = buildAiLearningPrivacyRecord({
    kind: input.kind,
    purpose: input.purpose,
    origin: input.origin,
    createdAt: input.createdAt,
    anonymizationApplied,
  });

  return {
    originalKind: input.kind,
    purpose: input.purpose,
    text: metadata.rawTextAllowed && !metadata.anonymizationRequired ? input.text ?? null : anonymized,
    structured: input.structured ?? null,
    metadata,
  };
}

export function assertGlobalRuleHasNoIdentifiableData(sample: SanitizedLearningSample) {
  const payload = `${sample.text ?? ""} ${JSON.stringify(sample.structured ?? {})}`;
  if (containsDirectIdentifier(payload)) {
    throw new Error("Regra global nao pode armazenar dado identificavel.");
  }

  if (!sample.metadata.globalPromotionAllowed && sample.metadata.purpose === "global_learning") {
    throw new Error("Amostra nao atende a politica de promocao global.");
  }

  return true;
}