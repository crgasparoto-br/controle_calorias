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
import { isValidIsoDate, isValidIsoInstant } from "./schemaShared";
import {
  isNonEmpty,
  isOpaqueIdentifier,
  isPositiveInteger,
  isValidPendingOperationEffect,
} from "./pendingOperationValidation";

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
        | "invalid-request-time"
        | "invalid-pending-time"
        | "invalid-pending-operation"
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
  | { applied: false; duplicate: true; effect: PendingOperationEffect }
  | {
      applied: false;
      duplicate: false;
      reason: Extract<PendingOperationResumeResult, { resumed: false }>["reason"];
      detail: string;
    };

const REASON_CODE_SET = new Set<string>(FOOD_REASON_CODES);

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
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      reason: "invalid-pending-operation",
      detail: "Pendência V2 deve ser um objeto estruturado.",
    };
  }
  const { versionTag } = input;

  if (!versionTag || typeof versionTag !== "object") {
    return {
      ok: false,
      reason: "invalid-pending-operation",
      detail: "Pendência V2 exige versionTag estruturado; nenhuma versão é inferida.",
    };
  }

  if (!input.target || typeof input.target !== "object") {
    return {
      ok: false,
      reason: "invalid-pending-operation",
      detail: "Pendência V2 exige target estruturado com refeição e data explícitas.",
    };
  }

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
    !isOpaqueIdentifier(input.operationKey) ||
    !isPositiveInteger(input.ownerUserId) ||
    !isValidIsoInstant(input.createdAt) ||
    !isValidIsoInstant(input.expiresAt) ||
    !Array.isArray(input.observationIds) ||
    input.observationIds.length === 0 ||
    input.observationIds.some(id => !isOpaqueIdentifier(id)) ||
    new Set(input.observationIds).size !== input.observationIds.length ||
    !isNonEmpty(input.target.mealLabel, 80) ||
    !isValidIsoDate(input.target.date) ||
    !isOpaqueIdentifier(versionTag.resolverVersion, 120) ||
    !isOpaqueIdentifier(versionTag.policyVersion, 120) ||
    !isOpaqueIdentifier(versionTag.lexiconRevision, 120) ||
    !isOpaqueIdentifier(versionTag.knowledgeRevision, 120)
  ) {
    return {
      ok: false,
      reason: "invalid-pending-operation",
      detail:
        "Pendência V2 exige operação identificada, proprietário autenticado, alvo explícito e versões completas.",
    };
  }

  // O tipo TS não garante que o payload JSON de runtime contenha code/ref.
  // Apenas null representa a ausência da pergunta; undefined não é aceito.
  const question: unknown = input.question;
  if (
    question !== null &&
    (!question || typeof question !== "object" || Array.isArray(question))
  ) {
    return {
      ok: false,
      reason: "invalid-pending-operation",
      detail: "question deve ser null ou objeto estruturado com code e ref.",
    };
  }
  if (question !== null) {
    const candidate = question as Partial<{ code: FoodReasonCode; ref: string }>;
    if (
      typeof candidate.code !== "string" ||
      !REASON_CODE_SET.has(candidate.code)
    ) {
      return {
        ok: false,
        reason: "invalid-reason-code",
        detail: `Motivo ${String(candidate.code)} não pertence ao registro tipado do domínio.`,
      };
    }
    if (
      !isOpaqueIdentifier(candidate.ref) ||
      Object.keys(question).some(key => key !== "code" && key !== "ref")
    ) {
      return {
        ok: false,
        reason: "invalid-pending-operation",
        detail: "question exige ref opaca válida, sem whitespace externo ou campos extras.",
      };
    }
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
  if (!pending || typeof pending !== "object" || !request || typeof request !== "object") {
    return {
      resumed: false,
      reason: "invalid-pending-operation",
      detail: "Pendência ou requisição malformada; retomada recusada sem efeito.",
    };
  }
  if (pending.versionTag === undefined) {
    return {
      resumed: false,
      reason: "pending-version-missing",
      detail: "Tag de versão ausente: somente null explícito identifica pendência legada.",
    };
  }
  if (pending.versionTag !== null &&
      (typeof pending.versionTag !== "object" || Array.isArray(pending.versionTag) ||
        !Number.isInteger(pending.versionTag.contractVersion))) {
    return {
      resumed: false,
      reason: "invalid-pending-operation",
      detail: "Tag de versão persistida inválida; nenhuma versão é inferida.",
    };
  }
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

  if (!isValidIsoInstant(request.now)) {
    return {
      resumed: false,
      reason: "invalid-request-time",
      detail: "Instante de retomada inválido; a expiração não pode ser ignorada por data ilegível.",
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

  const targetDate =
    typeof pending.target === "object" && pending.target !== null
      ? pending.target.date
      : null;
  if (
    !isValidIsoInstant(pending.createdAt) ||
    !isValidIsoInstant(pending.expiresAt) ||
    !isValidIsoDate(targetDate)
  ) {
    return {
      resumed: false,
      reason: "invalid-pending-time",
      detail:
        "Pendência V2 persistida possui createdAt, expiresAt ou target.date inválido; nenhum efeito é aplicado.",
    };
  }

  if (Date.parse(pending.expiresAt) <= Date.parse(pending.createdAt)) {
    return {
      resumed: false,
      reason: "invalid-pending-time",
      detail:
        "Pendência V2 persistida possui expiresAt não posterior a createdAt; nenhum efeito é aplicado.",
    };
  }

  // Na retomada, reaplicar o contrato completo usado na criação.
  if (!isValidPersistedV2Operation(pending)) {
    return {
      resumed: false,
      reason: "invalid-pending-operation",
      detail: "Pendência V2 persistida viola o contrato original; retry bloqueado.",
    };
  }

  if (Date.parse(request.now) < Date.parse(pending.createdAt)) {
    return {
      resumed: false,
      reason: "invalid-request-time",
      detail: "A retomada não pode anteceder a criação da pendência.",
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

/** Validação de estado V2 deserializado ou entregue por callers em runtime. */
export function isValidPersistedV2Operation(pending: PendingOperation): boolean {
  if (!pending || typeof pending !== "object" ||
      pending.versionTag === null || typeof pending.versionTag !== "object" ||
      !createPendingOperationV2({ ...pending, versionTag: pending.versionTag }).ok) {
    return false;
  }
  if (pending.effect === null) return true;
  return isValidPendingOperationEffect(pending.effect) &&
    Date.parse(pending.effect.appliedAt) >= Date.parse(pending.createdAt) &&
    Date.parse(pending.effect.appliedAt) < Date.parse(pending.expiresAt);
}

export {
  applyPendingOperationEffect,
  createInMemoryPendingOperationStore,
} from "./pendingOperationStore";
export type { PendingOperationStore, PendingOperationStoreState } from "./pendingOperationStore";
