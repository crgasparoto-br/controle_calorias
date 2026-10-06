/**
 * Pendência versionada de operação alimentar (§21.1, item 12).
 *
 * Regras canônicas implementadas aqui:
 * - a pendência guarda a versão do contrato/resolvedor com o alvo e os fatos
 *   originais; retry/continuação **não troca de resolvedor no meio da operação**;
 * - pendência V1 ativa (inclusive rótulo) permanece no handler legado
 *   identificado pelo seu contrato persistido: a versão **nunca** é inferida por
 *   data ou texto;
 * - consumir/cancelar/expirar encerra a pendência; a migração exige equivalência
 *   comprovada, sem reinterpretar pergunta anterior nem reaplicar efeito;
 * - revogação, perda de acesso ou contenção invalidam a execução e exigem falha
 *   explícita, não migração silenciosa;
 * - retry/restart não produzem efeito duplicado.
 *
 * A persistência durável (migrations e modelo físico V2) pertence à subissue
 * #1301 (Fase B1). Esta entrega define o contrato versionado e um store
 * serializável usado para provar sobrevivência a restart/retry sem efeito
 * duplicado. Nenhum entrypoint produtivo é migrado na Fase A1.
 */
import {
  FOOD_OBSERVATION_SCHEMA_VERSION,
  FOOD_REASON_CODES,
  type FoodReasonCode,
} from "./contracts";

/** Versão de contrato/resolvedor fixada com a pendência. */
export type PendingOperationVersionTag = {
  contractVersion: number;
  resolverVersion: string;
  policyVersion: string;
  lexiconRevision: string;
  knowledgeRevision: string;
};

export type PendingOperationTarget = {
  /** Refeição configurada do usuário é conhecimento operacional, não identidade alimentar. */
  mealLabel: string;
  /** Data explícita já resolvida pelo parser canônico de operação (§7.1.1). */
  date: string;
};

export type PendingOperationEffect = {
  effectId: string;
  appliedAt: string;
  /** Fato persistido que o efeito produziu; nunca recalculado em retry. */
  mealItemId: string;
};

export type PendingOperation = {
  operationKey: string;
  ownerUserId: number;
  createdAt: string;
  expiresAt: string;
  observationIds: string[];
  target: PendingOperationTarget;
  /** `null` identifica pendência legada sem tag de versão (§21.1). */
  versionTag: PendingOperationVersionTag | null;
  question: { code: FoodReasonCode; ref: string } | null;
  effect: PendingOperationEffect | null;
};

export type PendingOperationOwner = "v2" | "legacy-v1" | "unknown-version";

export type PendingOperationRequest = {
  operationKey: string;
  ownerUserId: number;
  contractVersion: number;
  resolverVersion: string;
  policyVersion: string;
  lexiconRevision: string;
  knowledgeRevision: string;
  authorization: "active" | "revoked" | "expired" | "restricted";
  now: string;
};

export type PendingOperationResumeResult =
  | {
      resumed: true;
      pending: PendingOperation;
      versions: PendingOperationVersionTag;
    }
  | {
      resumed: false;
      reason:
        | "operation-key-mismatch"
        | "owner-mismatch"
        | "expired"
        | "authorization-invalid"
        | "resolver-version-changed"
        | "legacy-handler-required"
        | "unsupported-schema-version"
        | "pending-version-missing";
      detail: string;
    };

export type PendingOperationEffectResult =
  | { applied: true; duplicate: false; effect: PendingOperationEffect }
  | { applied: false; duplicate: true; effect: PendingOperationEffect };

const REASON_CODE_SET = new Set<string>(FOOD_REASON_CODES);

function isNonEmpty(value: unknown, max = 200): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isIsoInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    value.includes("T")
  );
}

/**
 * Classifica o proprietário da pendência pelo contrato **persistido**.
 *
 * Ausência de tag nunca é convertida em V2: uma pendência antiga sem versão
 * permanece no handler legado. Data/texto não são critério.
 */
export function classifyPendingOperationOwner(
  pending: PendingOperation
): PendingOperationOwner {
  if (pending.versionTag === null) return "legacy-v1";
  if (pending.versionTag.contractVersion === 1) return "legacy-v1";
  if (
    pending.versionTag.contractVersion === FOOD_OBSERVATION_SCHEMA_VERSION
  ) {
    return "v2";
  }
  return "unknown-version";
}

export type PendingOperationCreationResult =
  | { ok: true; pending: PendingOperation; owner: PendingOperationOwner }
  | {
      ok: false;
      reason:
        | "unsupported-schema-version"
        | "invalid-pending-operation"
        | "invalid-reason-code";
      detail: string;
    };

/**
 * Cria a pendência V2 fixando a versão do contrato e do resolvedor.
 *
 * Versão de contrato incompatível é rejeitada **antes** de qualquer mutação; não
 * existe default silencioso para a versão corrente.
 */
export function createPendingOperationV2(input: {
  operationKey: string;
  ownerUserId: number;
  createdAt: string;
  expiresAt: string;
  observationIds: string[];
  target: PendingOperationTarget;
  question: { code: FoodReasonCode; ref: string } | null;
  versionTag: PendingOperationVersionTag;
}): PendingOperationCreationResult {
  const { versionTag } = input;

  if (versionTag.contractVersion !== FOOD_OBSERVATION_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "unsupported-schema-version",
      detail:
        `contractVersion=${String(versionTag.contractVersion)} não é suportado por esta pendência V2 ` +
        `(esperado ${FOOD_OBSERVATION_SCHEMA_VERSION}). Nenhuma versão é assumida implicitamente.`,
    };
  }

  if (
    !isNonEmpty(input.operationKey) ||
    !isPositiveInteger(input.ownerUserId) ||
    !isIsoInstant(input.createdAt) ||
    !isIsoInstant(input.expiresAt) ||
    !Array.isArray(input.observationIds) ||
    input.observationIds.length === 0 ||
    input.observationIds.some(id => !isNonEmpty(id)) ||
    new Set(input.observationIds).size !== input.observationIds.length ||
    !isNonEmpty(input.target.mealLabel, 80) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.target.date) ||
    !isNonEmpty(versionTag.resolverVersion, 120) ||
    !isNonEmpty(versionTag.policyVersion, 120) ||
    !isNonEmpty(versionTag.lexiconRevision, 120) ||
    !isNonEmpty(versionTag.knowledgeRevision, 120)
  ) {
    return {
      ok: false,
      reason: "invalid-pending-operation",
      detail:
        "Pendência V2 exige operação identificada, proprietário autenticado, alvo explícito e versões completas.",
    };
  }

  if (input.question !== null && !REASON_CODE_SET.has(input.question.code)) {
    return {
      ok: false,
      reason: "invalid-reason-code",
      detail: `Motivo ${String(input.question.code)} não pertence ao registro tipado do domínio.`,
    };
  }

  if (Date.parse(input.expiresAt) <= Date.parse(input.createdAt)) {
    return {
      ok: false,
      reason: "invalid-pending-operation",
      detail: "expiresAt deve ser posterior a createdAt.",
    };
  }

  const pending: PendingOperation = {
    operationKey: input.operationKey,
    ownerUserId: input.ownerUserId,
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
    observationIds: [...input.observationIds],
    target: { ...input.target },
    versionTag: { ...versionTag },
    question: input.question ? { ...input.question } : null,
    effect: null,
  };

  return { ok: true, pending, owner: classifyPendingOperationOwner(pending) };
}

/**
 * Retoma a pendência versionada.
 *
 * Falha explícita (sem migração silenciosa) quando: a chave de operação ou o
 * proprietário não coincidem, a pendência expirou, a autorização não está mais
 * ativa ou a versão do resolvedor/política difere da fixada.
 */
export function resumePendingOperation(
  pending: PendingOperation,
  request: PendingOperationRequest
): PendingOperationResumeResult {
  if (pending.operationKey !== request.operationKey) {
    return {
      resumed: false,
      reason: "operation-key-mismatch",
      detail:
        "Chave idempotente da operação difere; retry de outra operação nunca retoma esta pendência.",
    };
  }

  if (pending.ownerUserId !== request.ownerUserId) {
    return {
      resumed: false,
      reason: "owner-mismatch",
      detail: "Pendência pertence a outro proprietário autenticado.",
    };
  }

  const owner = classifyPendingOperationOwner(pending);
  if (owner === "unknown-version") {
    return {
      resumed: false,
      reason: "unsupported-schema-version",
      detail:
        `Pendência declara contractVersion=${String(pending.versionTag?.contractVersion)}, desconhecida por este runtime; versão futura nunca é tratada como V1.`,
    };
  }

  if (owner === "legacy-v1") {
    return {
      resumed: false,
      reason: "legacy-handler-required",
      detail:
        "Pendência legada sem tag ou com contrato V1 permanece no handler compatível; a versão nunca é inferida por data ou texto.",
    };
  }

  const pinned = pending.versionTag;
  if (pinned === null) {
    return {
      resumed: false,
      reason: "pending-version-missing",
      detail:
        "Pendência sem versão fixada não pode ser retomada pelo resolvedor V2.",
    };
  }

  if (Date.parse(request.now) >= Date.parse(pending.expiresAt)) {
    return {
      resumed: false,
      reason: "expired",
      detail: "Pendência expirada encerra a operação sem reaplicar efeito.",
    };
  }

  if (request.authorization !== "active") {
    return {
      resumed: false,
      reason: "authorization-invalid",
      detail: `Autorização=${request.authorization} invalida a execução; exige falha explícita e retomada autorizada, nunca migração silenciosa.`,
    };
  }

  if (
    request.contractVersion !== pinned.contractVersion ||
    request.resolverVersion !== pinned.resolverVersion ||
    request.policyVersion !== pinned.policyVersion ||
    request.lexiconRevision !== pinned.lexiconRevision ||
    request.knowledgeRevision !== pinned.knowledgeRevision
  ) {
    return {
      resumed: false,
      reason: "resolver-version-changed",
      detail:
        "Retry/continuação não troca de resolvedor no meio da operação; a versão fixada prevalece sobre a versão corrente.",
    };
  }

  return { resumed: true, pending, versions: pinned };
}

/**
 * Aplica o efeito da pendência de forma idempotente.
 *
 * Restart/retry com a mesma chave nunca duplica o efeito: a segunda aplicação
 * devolve o efeito já registrado (`duplicate=true`).
 */
export function applyPendingOperationEffect(
  store: PendingOperationStore,
  input: {
    operationKey: string;
    ownerUserId: number;
    effect: PendingOperationEffect;
  }
): PendingOperationEffectResult {
  const pending = store.get(input.operationKey);
  if (!pending || pending.ownerUserId !== input.ownerUserId) {
    throw new Error("Pendência não encontrada para aplicação de efeito.");
  }
  if (pending.effect) {
    return { applied: false, duplicate: true, effect: pending.effect };
  }
  const applied: PendingOperationEffect = { ...input.effect };
  store.save({ ...pending, effect: applied });
  return { applied: true, duplicate: false, effect: applied };
}

export type PendingOperationStoreState = {
  schemaVersion: 1;
  operations: PendingOperation[];
};

export type PendingOperationStore = {
  get(operationKey: string): PendingOperation | null;
  save(pending: PendingOperation): void;
  exportState(): PendingOperationStoreState;
};

/**
 * Store serializável usado para provar que a pendência versionada sobrevive a
 * restart sem efeito duplicado. A persistência durável é entregue pela #1301.
 */
export function createInMemoryPendingOperationStore(
  initialState?: PendingOperationStoreState
): PendingOperationStore {
  const operations = new Map<string, PendingOperation>();
  for (const pending of initialState?.operations ?? []) {
    operations.set(pending.operationKey, clonePendingOperation(pending));
  }

  return {
    get(operationKey) {
      const pending = operations.get(operationKey);
      return pending ? clonePendingOperation(pending) : null;
    },
    save(pending) {
      operations.set(pending.operationKey, clonePendingOperation(pending));
    },
    exportState() {
      return {
        schemaVersion: 1,
        operations: [...operations.values()].map(clonePendingOperation),
      };
    },
  };
}

function clonePendingOperation(pending: PendingOperation): PendingOperation {
  return {
    ...pending,
    observationIds: [...pending.observationIds],
    target: { ...pending.target },
    versionTag: pending.versionTag ? { ...pending.versionTag } : null,
    question: pending.question ? { ...pending.question } : null,
    effect: pending.effect ? { ...pending.effect } : null,
  };
}
