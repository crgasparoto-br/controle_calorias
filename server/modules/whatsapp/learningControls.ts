export const WHATSAPP_LEARNING_CONTROLS_VERSION = "whatsapp-learning-controls/v1";

export type WhatsappLearningDataScope = "operational" | "audit" | "individual_memory" | "global_anonymized_learning";
export type WhatsappLearningPreferenceSource = "whatsapp" | "settings_screen" | "admin" | "system_default";
export type WhatsappLearningUseDecision = "allowed" | "blocked" | "audit_only";
export type WhatsappIndividualMemoryStatus = "active" | "disabled" | "expired";

export type WhatsappLearningPreference = {
  userId: number;
  individualMemoryEnabled: boolean;
  globalAnonymizedLearningEnabled: boolean;
  source: WhatsappLearningPreferenceSource;
  appliedAt: string;
  preferenceVersion: typeof WHATSAPP_LEARNING_CONTROLS_VERSION;
  notes?: string | null;
};

export type WhatsappIndividualMemoryControl = {
  id: number;
  userId: number;
  key: string;
  summary: string;
  status: WhatsappIndividualMemoryStatus;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  disabledReason: string | null;
  controlVersion: typeof WHATSAPP_LEARNING_CONTROLS_VERSION;
};

export type WhatsappLearningUseEvaluation = {
  userId: number;
  scope: WhatsappLearningDataScope;
  decision: WhatsappLearningUseDecision;
  reason: string;
  preference: WhatsappLearningPreference;
  canFeedDataset: boolean;
  canCreateGlobalCandidate: boolean;
  canUpdateIndividualMemory: boolean;
  operationalTracePreserved: boolean;
  evaluatedAt: string;
  policyVersion: typeof WHATSAPP_LEARNING_CONTROLS_VERSION;
};

type SetPreferenceInput = {
  userId: number;
  individualMemoryEnabled?: boolean;
  globalAnonymizedLearningEnabled?: boolean;
  source: WhatsappLearningPreferenceSource;
  appliedAt?: Date;
  notes?: string | null;
};

type RecordMemoryInput = {
  userId: number;
  key: string;
  summary: string;
  createdAt?: Date;
};

const preferences = new Map<number, WhatsappLearningPreference>();
const memories: WhatsappIndividualMemoryControl[] = [];
let nextMemoryId = 1;

export const WHATSAPP_LEARNING_CONTROLS_POLICY = {
  dataScopes: {
    operational: "Dado minimo necessario para processar a conversa e manter seguranca do produto.",
    audit: "Trilha necessaria para auditoria, abuso, seguranca e investigacao de erro.",
    individual_memory: "Personalizacao individual, revisavel e desativavel quando viavel.",
    global_anonymized_learning: "Sinal anonimizado para dataset, metricas, candidatos e melhoria global governada.",
  },
  globalLearningDefault: true,
  individualMemoryDefault: true,
  operationalAndAuditAlwaysPreserved: true,
  directGlobalPromotionAllowed: false,
  integrations: {
    initialProtection: "#410",
    feedbackLoop: "#430",
    privacy: "#432",
    regressionManagement: "#433",
    governance: "#443",
    security: "#444",
    labelingProtocol: "#448",
  },
  version: WHATSAPP_LEARNING_CONTROLS_VERSION,
} as const;

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function defaultPreference(userId: number): WhatsappLearningPreference {
  return {
    userId,
    individualMemoryEnabled: WHATSAPP_LEARNING_CONTROLS_POLICY.individualMemoryDefault,
    globalAnonymizedLearningEnabled: WHATSAPP_LEARNING_CONTROLS_POLICY.globalLearningDefault,
    source: "system_default",
    appliedAt: new Date(0).toISOString(),
    preferenceVersion: WHATSAPP_LEARNING_CONTROLS_VERSION,
    notes: "Preferencia padrao aplicada ate configuracao explicita do usuario.",
  };
}

export function setWhatsappLearningPreference(input: SetPreferenceInput): WhatsappLearningPreference {
  const current = preferences.get(input.userId) ?? defaultPreference(input.userId);
  const appliedAt = toIso(input.appliedAt);
  const preference: WhatsappLearningPreference = {
    userId: input.userId,
    individualMemoryEnabled: input.individualMemoryEnabled ?? current.individualMemoryEnabled,
    globalAnonymizedLearningEnabled: input.globalAnonymizedLearningEnabled ?? current.globalAnonymizedLearningEnabled,
    source: input.source,
    appliedAt,
    preferenceVersion: WHATSAPP_LEARNING_CONTROLS_VERSION,
    notes: input.notes ?? null,
  };
  preferences.set(input.userId, preference);
  return preference;
}

export function getWhatsappLearningPreference(userId: number): WhatsappLearningPreference {
  return preferences.get(userId) ?? defaultPreference(userId);
}

export function evaluateWhatsappLearningUse(input: { userId: number; scope: WhatsappLearningDataScope; evaluatedAt?: Date }): WhatsappLearningUseEvaluation {
  const preference = getWhatsappLearningPreference(input.userId);
  const evaluatedAt = toIso(input.evaluatedAt);
  if (input.scope === "operational" || input.scope === "audit") {
    return {
      userId: input.userId,
      scope: input.scope,
      decision: input.scope === "audit" ? "audit_only" : "allowed",
      reason: "Uso operacional e auditoria minima sao preservados para seguranca e funcionamento do produto.",
      preference,
      canFeedDataset: false,
      canCreateGlobalCandidate: false,
      canUpdateIndividualMemory: false,
      operationalTracePreserved: true,
      evaluatedAt,
      policyVersion: WHATSAPP_LEARNING_CONTROLS_VERSION,
    };
  }

  if (input.scope === "individual_memory") {
    const allowed = preference.individualMemoryEnabled;
    return {
      userId: input.userId,
      scope: input.scope,
      decision: allowed ? "allowed" : "blocked",
      reason: allowed ? "Memoria individual permitida pela preferencia atual." : "Usuario desativou memoria individual.",
      preference,
      canFeedDataset: false,
      canCreateGlobalCandidate: false,
      canUpdateIndividualMemory: allowed,
      operationalTracePreserved: true,
      evaluatedAt,
      policyVersion: WHATSAPP_LEARNING_CONTROLS_VERSION,
    };
  }

  const allowed = preference.globalAnonymizedLearningEnabled;
  return {
    userId: input.userId,
    scope: input.scope,
    decision: allowed ? "allowed" : "blocked",
    reason: allowed ? "Contribuicao global anonimizada permitida pela preferencia atual." : "Usuario desativou contribuicao para aprendizado global anonimizado.",
    preference,
    canFeedDataset: allowed,
    canCreateGlobalCandidate: allowed,
    canUpdateIndividualMemory: false,
    operationalTracePreserved: true,
    evaluatedAt,
    policyVersion: WHATSAPP_LEARNING_CONTROLS_VERSION,
  };
}

export function recordWhatsappIndividualMemory(input: RecordMemoryInput) {
  const decision = evaluateWhatsappLearningUse({ userId: input.userId, scope: "individual_memory", evaluatedAt: input.createdAt });
  if (!decision.canUpdateIndividualMemory) return null;
  const createdAt = toIso(input.createdAt);
  const memory: WhatsappIndividualMemoryControl = {
    id: nextMemoryId,
    userId: input.userId,
    key: input.key,
    summary: input.summary,
    status: "active",
    createdAt,
    updatedAt: createdAt,
    disabledAt: null,
    disabledReason: null,
    controlVersion: WHATSAPP_LEARNING_CONTROLS_VERSION,
  };
  nextMemoryId += 1;
  memories.push(memory);
  return memory;
}

export function disableWhatsappIndividualMemory(input: { memoryId: number; userId: number; reason: string; disabledAt?: Date }) {
  const memory = memories.find(item => item.id === input.memoryId && item.userId === input.userId);
  if (!memory || memory.status !== "active") return null;
  const disabledAt = toIso(input.disabledAt);
  memory.status = "disabled";
  memory.updatedAt = disabledAt;
  memory.disabledAt = disabledAt;
  memory.disabledReason = input.reason;
  return memory;
}

export function listWhatsappIndividualMemories(userId: number, status?: WhatsappIndividualMemoryStatus) {
  return memories.filter(memory => memory.userId === userId && (!status || memory.status === status));
}

export function __resetWhatsappLearningControlsForTests() {
  preferences.clear();
  memories.length = 0;
  nextMemoryId = 1;
}
