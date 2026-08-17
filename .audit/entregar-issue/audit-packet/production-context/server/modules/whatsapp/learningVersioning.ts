export const WHATSAPP_LEARNING_VERSIONING_VERSION = "whatsapp-learning-versioning/v1";

export type WhatsappVersionedArtifactCategory =
  | "prompt"
  | "intent_taxonomy"
  | "structured_schema"
  | "global_rule"
  | "curated_nutrition_source"
  | "food_classification"
  | "confidence_calibrator"
  | "risk_threshold_policy"
  | "promotion_policy"
  | "governance_policy"
  | "explanation_template";

export type WhatsappVersionedArtifactStatus = "draft" | "active" | "inactive" | "rolled_back";

export type WhatsappVersionedArtifact = {
  id: number;
  category: WhatsappVersionedArtifactCategory;
  version: string;
  status: WhatsappVersionedArtifactStatus;
  origin: string;
  confidence: number;
  responsible: string;
  reason: string;
  createdAt: string;
  activatedAt: string | null;
  deactivatedAt: string | null;
  rollbackToVersion: string | null;
  governanceCandidateId: number | null;
  metadata: Record<string, unknown>;
  versioningPolicy: typeof WHATSAPP_LEARNING_VERSIONING_VERSION;
};

export type WhatsappDecisionVersionSnapshot = {
  createdAt: string;
  promptVersion: string;
  intentTaxonomyVersion: string;
  schemaVersion: string;
  globalRuleVersion: string;
  nutritionSourceVersion: string;
  foodClassificationVersion: string;
  confidenceCalibratorVersion: string;
  riskThresholdPolicyVersion: string;
  promotionPolicyVersion: string;
  governancePolicyVersion: string;
  explanationTemplateVersion: string;
  modelName: string | null;
  parserVersion: string | null;
  versioningPolicy: typeof WHATSAPP_LEARNING_VERSIONING_VERSION;
};

export type WhatsappVersioningAuditEvent = {
  id: number;
  createdAt: string;
  type: "registered" | "activated" | "deactivated" | "rollback" | "snapshot_created";
  category: WhatsappVersionedArtifactCategory | null;
  version: string | null;
  responsible: string;
  reason: string;
  relatedVersion: string | null;
  versioningPolicy: typeof WHATSAPP_LEARNING_VERSIONING_VERSION;
};

type RegisterArtifactInput = {
  category: WhatsappVersionedArtifactCategory;
  version: string;
  origin: string;
  confidence: number;
  responsible: string;
  reason: string;
  status?: WhatsappVersionedArtifactStatus;
  governanceCandidateId?: number | null;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
};

type BuildSnapshotInput = {
  createdAt?: Date;
  modelName?: string | null;
  parserVersion?: string | null;
  overrides?: Partial<Omit<WhatsappDecisionVersionSnapshot, "createdAt" | "versioningPolicy">>;
};

const artifacts: WhatsappVersionedArtifact[] = [];
const auditEvents: WhatsappVersioningAuditEvent[] = [];
let nextArtifactId = 1;
let nextAuditId = 1;

const DEFAULT_ACTIVE_VERSIONS: Record<WhatsappVersionedArtifactCategory, string> = {
  prompt: "whatsapp-prompt/v1",
  intent_taxonomy: "whatsapp-intent-taxonomy/v1",
  structured_schema: "whatsapp-intent-schema/v1",
  global_rule: "whatsapp-global-rules/v1",
  curated_nutrition_source: "nutrition-source-curation/v1",
  food_classification: "food-classification/v1",
  confidence_calibrator: "confidence-calibrator/v1",
  risk_threshold_policy: "risk-threshold-policy/v1",
  promotion_policy: "learning-promotion-policy/v1",
  governance_policy: "whatsapp-learning-governance/v1",
  explanation_template: "decision-explanation-template/v1",
};

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function recordAudit(input: Omit<WhatsappVersioningAuditEvent, "id" | "createdAt" | "versioningPolicy"> & { createdAt?: string }) {
  const event: WhatsappVersioningAuditEvent = {
    id: nextAuditId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    type: input.type,
    category: input.category,
    version: input.version,
    responsible: input.responsible,
    reason: input.reason,
    relatedVersion: input.relatedVersion,
    versioningPolicy: WHATSAPP_LEARNING_VERSIONING_VERSION,
  };
  nextAuditId += 1;
  auditEvents.push(event);
  return event;
}

function activeArtifact(category: WhatsappVersionedArtifactCategory) {
  return artifacts.find(item => item.category === category && item.status === "active") ?? null;
}

function ensureDefaultArtifact(category: WhatsappVersionedArtifactCategory) {
  const active = activeArtifact(category);
  if (active) return active;
  const createdAt = new Date("2026-06-16T00:00:00.000Z").toISOString();
  const artifact: WhatsappVersionedArtifact = {
    id: nextArtifactId,
    category,
    version: DEFAULT_ACTIVE_VERSIONS[category],
    status: "active",
    origin: "default-baseline",
    confidence: 1,
    responsible: "system",
    reason: "Versao ativa inicial para rastreabilidade de decisoes.",
    createdAt,
    activatedAt: createdAt,
    deactivatedAt: null,
    rollbackToVersion: null,
    governanceCandidateId: null,
    metadata: {},
    versioningPolicy: WHATSAPP_LEARNING_VERSIONING_VERSION,
  };
  nextArtifactId += 1;
  artifacts.push(artifact);
  return artifact;
}

export function registerWhatsappVersionedArtifact(input: RegisterArtifactInput) {
  const createdAt = toIso(input.createdAt);
  const status = input.status ?? "draft";
  if (status === "active") {
    for (const artifact of artifacts) {
      if (artifact.category === input.category && artifact.status === "active") {
        artifact.status = "inactive";
        artifact.deactivatedAt = createdAt;
      }
    }
  }

  const artifact: WhatsappVersionedArtifact = {
    id: nextArtifactId,
    category: input.category,
    version: input.version,
    status,
    origin: input.origin,
    confidence: clampConfidence(input.confidence),
    responsible: input.responsible,
    reason: input.reason,
    createdAt,
    activatedAt: status === "active" ? createdAt : null,
    deactivatedAt: null,
    rollbackToVersion: null,
    governanceCandidateId: input.governanceCandidateId ?? null,
    metadata: input.metadata ?? {},
    versioningPolicy: WHATSAPP_LEARNING_VERSIONING_VERSION,
  };
  nextArtifactId += 1;
  artifacts.push(artifact);
  recordAudit({
    createdAt,
    type: status === "active" ? "activated" : "registered",
    category: artifact.category,
    version: artifact.version,
    responsible: artifact.responsible,
    reason: artifact.reason,
    relatedVersion: null,
  });
  return artifact;
}

export function activateWhatsappVersionedArtifact(input: {
  category: WhatsappVersionedArtifactCategory;
  version: string;
  responsible: string;
  reason: string;
  activatedAt?: Date;
}) {
  const artifact = artifacts.find(item => item.category === input.category && item.version === input.version);
  if (!artifact || artifact.status === "rolled_back") return null;
  const activatedAt = toIso(input.activatedAt);
  for (const item of artifacts) {
    if (item.category === input.category && item.status === "active") {
      item.status = "inactive";
      item.deactivatedAt = activatedAt;
    }
  }
  artifact.status = "active";
  artifact.activatedAt = activatedAt;
  artifact.deactivatedAt = null;
  recordAudit({
    createdAt: activatedAt,
    type: "activated",
    category: artifact.category,
    version: artifact.version,
    responsible: input.responsible,
    reason: input.reason,
    relatedVersion: null,
  });
  return artifact;
}

export function rollbackWhatsappVersionedArtifact(input: {
  category: WhatsappVersionedArtifactCategory;
  version: string;
  rollbackToVersion: string;
  responsible: string;
  reason: string;
  rolledBackAt?: Date;
}) {
  const target = artifacts.find(item => item.category === input.category && item.version === input.version);
  const restore = artifacts.find(item => item.category === input.category && item.version === input.rollbackToVersion);
  if (!target || !restore) return null;
  const rolledBackAt = toIso(input.rolledBackAt);
  target.status = "rolled_back";
  target.deactivatedAt = rolledBackAt;
  target.rollbackToVersion = restore.version;
  for (const item of artifacts) {
    if (item.category === input.category && item.id !== restore.id && item.status === "active") {
      item.status = "inactive";
      item.deactivatedAt = rolledBackAt;
    }
  }
  restore.status = "active";
  restore.activatedAt = rolledBackAt;
  restore.deactivatedAt = null;
  recordAudit({
    createdAt: rolledBackAt,
    type: "rollback",
    category: input.category,
    version: target.version,
    responsible: input.responsible,
    reason: input.reason,
    relatedVersion: restore.version,
  });
  return { rolledBack: target, restored: restore };
}

export function getActiveWhatsappVersion(category: WhatsappVersionedArtifactCategory) {
  return ensureDefaultArtifact(category);
}

export function buildWhatsappDecisionVersionSnapshot(input: BuildSnapshotInput = {}): WhatsappDecisionVersionSnapshot {
  const snapshot: WhatsappDecisionVersionSnapshot = {
    createdAt: toIso(input.createdAt),
    promptVersion: getActiveWhatsappVersion("prompt").version,
    intentTaxonomyVersion: getActiveWhatsappVersion("intent_taxonomy").version,
    schemaVersion: getActiveWhatsappVersion("structured_schema").version,
    globalRuleVersion: getActiveWhatsappVersion("global_rule").version,
    nutritionSourceVersion: getActiveWhatsappVersion("curated_nutrition_source").version,
    foodClassificationVersion: getActiveWhatsappVersion("food_classification").version,
    confidenceCalibratorVersion: getActiveWhatsappVersion("confidence_calibrator").version,
    riskThresholdPolicyVersion: getActiveWhatsappVersion("risk_threshold_policy").version,
    promotionPolicyVersion: getActiveWhatsappVersion("promotion_policy").version,
    governancePolicyVersion: getActiveWhatsappVersion("governance_policy").version,
    explanationTemplateVersion: getActiveWhatsappVersion("explanation_template").version,
    modelName: input.modelName ?? null,
    parserVersion: input.parserVersion ?? null,
    versioningPolicy: WHATSAPP_LEARNING_VERSIONING_VERSION,
    ...input.overrides,
  };
  recordAudit({
    createdAt: snapshot.createdAt,
    type: "snapshot_created",
    category: null,
    version: snapshot.schemaVersion,
    responsible: "system",
    reason: "Snapshot de versoes usado para interpretar decisao do WhatsApp.",
    relatedVersion: snapshot.promptVersion,
  });
  return snapshot;
}

export function buildWhatsappVersionedDecisionTrace(input: {
  messageHistoryId: number;
  userId?: number | null;
  intent: string;
  action: string;
  snapshot: WhatsappDecisionVersionSnapshot;
}) {
  return {
    messageHistoryId: input.messageHistoryId,
    userId: input.userId ?? null,
    intent: input.intent,
    action: input.action,
    interpretedBy: {
      promptVersion: input.snapshot.promptVersion,
      schemaVersion: input.snapshot.schemaVersion,
      taxonomyVersion: input.snapshot.intentTaxonomyVersion,
      globalRuleVersion: input.snapshot.globalRuleVersion,
      nutritionSourceVersion: input.snapshot.nutritionSourceVersion,
      confidenceCalibratorVersion: input.snapshot.confidenceCalibratorVersion,
      thresholdPolicyVersion: input.snapshot.riskThresholdPolicyVersion,
      governancePolicyVersion: input.snapshot.governancePolicyVersion,
      explanationTemplateVersion: input.snapshot.explanationTemplateVersion,
      modelName: input.snapshot.modelName,
      parserVersion: input.snapshot.parserVersion,
    },
    versioningPolicy: input.snapshot.versioningPolicy,
  };
}

export function listWhatsappVersionedArtifacts(filter: Partial<Pick<WhatsappVersionedArtifact, "category" | "status" | "version">> = {}) {
  return artifacts.filter(artifact => {
    if (filter.category && artifact.category !== filter.category) return false;
    if (filter.status && artifact.status !== filter.status) return false;
    if (filter.version && artifact.version !== filter.version) return false;
    return true;
  });
}

export function listWhatsappVersioningAuditEvents(filter: Partial<Pick<WhatsappVersioningAuditEvent, "type" | "category" | "version">> = {}) {
  return auditEvents.filter(event => {
    if (filter.type && event.type !== filter.type) return false;
    if (filter.category && event.category !== filter.category) return false;
    if (filter.version && event.version !== filter.version) return false;
    return true;
  });
}

export function __resetWhatsappLearningVersioningForTests() {
  artifacts.length = 0;
  auditEvents.length = 0;
  nextArtifactId = 1;
  nextAuditId = 1;
}
