/**
 * Store serializável de pendências V2 (fase A1). Toda mutação de efeito usa
 * commit validado no mesmo estado; save() nunca confirma efeitos implicitamente.
 * A persistência durável e as transações reais pertencem à issue #1301.
 */
import {
  classifyPendingOperationOwner,
  isValidPersistedV2Operation,
  resumePendingOperation,
  type PendingOperation,
  type PendingOperationEffect,
  type PendingOperationEffectResult,
  type PendingOperationRequest,
} from "./pendingOperation";
import {
  assertMonotonicPendingSave,
  isValidPendingOperationEffect,
} from "./pendingOperationValidation";

export type PendingOperationStoreState = {
  schemaVersion: 1;
  operations: PendingOperation[];
};

export type PendingOperationStore = {
  get(operationKey: string): PendingOperation | null;
  save(pending: PendingOperation): void;
  applyEffect(input: {
    request: PendingOperationRequest;
    effect: PendingOperationEffect;
  }): PendingOperationEffectResult;
  exportState(): PendingOperationStoreState;
};

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

/** Rejeita qualquer gravação V2 não verificável, inclusive estado inicial. */
function assertWritablePending(pending: PendingOperation): void {
  if (!pending || typeof pending !== "object" ||
      typeof pending.operationKey !== "string" ||
      pending.versionTag === undefined ||
      (pending.versionTag !== null && typeof pending.versionTag !== "object")) {
    throw new Error("Pendência persistida malformada ou sem versão explícita.");
  }
  const owner = classifyPendingOperationOwner(pending);
  if (owner === "unknown-version") {
    throw new Error("Versão de pendência desconhecida; gravação recusada.");
  }
  if (owner === "v2" && !isValidPersistedV2Operation(pending)) {
    throw new Error("Pendência V2 persistida inválida; gravação recusada.");
  }
}

/** Única entrada para aplicar efeitos: a validação e o commit são síncronos. */
export function applyPendingOperationEffect(
  store: PendingOperationStore,
  input: { request: PendingOperationRequest; effect: PendingOperationEffect }
): PendingOperationEffectResult {
  return store.applyEffect(input);
}

export function createInMemoryPendingOperationStore(
  initialState?: PendingOperationStoreState
): PendingOperationStore {
  if (initialState &&
      (initialState.schemaVersion !== 1 || !Array.isArray(initialState.operations))) {
    throw new Error("Envelope de pendências persistidas possui versão ou coleção inválida.");
  }
  const operations = new Map<string, PendingOperation>();
  for (const pending of initialState?.operations ?? []) {
    if (!pending || typeof pending.operationKey !== "string" ||
        operations.has(pending.operationKey)) {
      throw new Error("Pendência persistida malformada ou chave duplicada.");
    }
    try {
      assertWritablePending(pending);
    } catch {
      throw new Error("Pendência V2 persistida inválida; restauração recusada.");
    }
    operations.set(pending.operationKey, clonePendingOperation(pending));
  }

  return {
    get(operationKey) {
      const pending = operations.get(operationKey);
      return pending ? clonePendingOperation(pending) : null;
    },
    save(pending) {
      assertWritablePending(pending);
      const existing = operations.get(pending.operationKey);
      if (existing) {
        assertMonotonicPendingSave(existing, pending);
        if (existing.effect === null && pending.effect !== null) {
          throw new Error("Efeito só pode ser confirmado por applyPendingOperationEffect.");
        }
      } else if (pending.effect !== null) {
        throw new Error("Nova pendência não pode declarar efeito previamente aplicado via save.");
      }
      operations.set(pending.operationKey, clonePendingOperation(pending));
    },
    applyEffect({ request, effect }) {
      const pending = operations.get(request.operationKey);
      if (!pending || pending.ownerUserId !== request.ownerUserId) {
        throw new Error("Pendência não encontrada para aplicação de efeito.");
      }
      const resumed = resumePendingOperation(pending, request);
      if (!resumed.resumed) {
        return {
          applied: false,
          duplicate: false,
          reason: resumed.reason,
          detail: resumed.detail,
        };
      }
      if (pending.effect) {
        return { applied: false, duplicate: true, effect: { ...pending.effect } };
      }
      if (!isValidPendingOperationEffect(effect) ||
          Date.parse(effect.appliedAt) < Date.parse(pending.createdAt) ||
          Date.parse(effect.appliedAt) < Date.parse(request.now) ||
          Date.parse(effect.appliedAt) >= Date.parse(pending.expiresAt)) {
        return {
          applied: false,
          duplicate: false,
          reason: "invalid-pending-time",
          detail: "Efeito recebido possui appliedAt ou identificadores inválidos; nenhum efeito é persistido.",
        };
      }
      const applied = { ...effect };
      // Sem await entre validar e gravar, nenhuma gravação obsoleta passa.
      operations.set(pending.operationKey, { ...pending, effect: applied });
      return { applied: true, duplicate: false, effect: { ...applied } };
    },
    exportState() {
      return {
        schemaVersion: 1,
        operations: [...operations.values()].map(clonePendingOperation),
      };
    },
  };
}
