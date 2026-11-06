import {
  PENDING_OPERATION_PROCESSING_LEASE_MS,
  type CreatePendingOperationInput,
  type WhatsAppPendingOperationRecord,
  type WhatsAppPendingOperationState,
} from "./whatsappPendingOperationTypes";

function expireFallbackOperation(
  row: WhatsAppPendingOperationRecord,
  now: Date
) {
  if (
    (row.state !== "active" &&
      row.state !== "processing" &&
      row.state !== "review_required") ||
    new Date(row.expiresAt).getTime() >= now.getTime()
  )
    return false;
  Object.assign(row, {
    state: "expired",
    dedupeKey: null,
    version: row.version + 1,
    updatedAt: now,
  });
  return true;
}

function expireFallbackOperations(
  now: Date,
  predicate: (row: WhatsAppPendingOperationRecord) => boolean = () => true
) {
  for (const row of fallbackStore.values()) {
    if (predicate(row)) expireFallbackOperation(row, now);
  }
}

function reviewAbandonedProcessingOperations(
  now: Date,
  predicate: (row: WhatsAppPendingOperationRecord) => boolean = () => true,
  leaseMs = PENDING_OPERATION_PROCESSING_LEASE_MS
) {
  for (const row of fallbackStore.values()) {
    if (
      predicate(row) &&
      row.state === "processing" &&
      new Date(row.expiresAt).getTime() >= now.getTime() &&
      new Date(row.updatedAt).getTime() + leaseMs <= now.getTime()
    ) {
      Object.assign(row, {
        state: "review_required",
        dedupeKey: null,
        version: row.version + 1,
        updatedAt: now,
        consumedAt: now,
      });
    }
  }
}

/**
 * A memória do processo existe somente para testes e desenvolvimento local
 * explicitamente autorizado por `canUseMemoryPersistenceFallback()`. Produção
 * falha fechado quando a persistência durável não está disponível, impedindo
 * perguntas órfãs e estado que não possa ser reconstruído após reinício.
 */
let fallbackNextId = 1;
const fallbackStore = new Map<number, WhatsAppPendingOperationRecord>();

function createFallbackStore() {
  return {
    create(input: CreatePendingOperationInput): WhatsAppPendingOperationRecord {
      const now = input.now ?? new Date();
      if (input.dedupeKey) {
        expireFallbackOperations(now, row => row.dedupeKey === input.dedupeKey);
      }
      const existing = input.dedupeKey
        ? [...fallbackStore.values()].find(
            row =>
              row.dedupeKey === input.dedupeKey &&
              row.state === "active" &&
              new Date(row.expiresAt).getTime() >= now.getTime()
          )
        : null;
      if (existing) return existing;
      const record = {
        id: fallbackNextId++,
        userId: input.userId,
        type: input.type,
        target: input.target,
        dedupeKey: input.dedupeKey ?? null,
        origin: input.origin,
        state: "active",
        version: 1,
        createdAt: now,
        expiresAt: new Date(now.getTime() + input.ttlMs),
        updatedAt: now,
        consumedAt: null,
      } as unknown as WhatsAppPendingOperationRecord;
      fallbackStore.set(record.id, record);
      return record;
    },
    getActive(
      userId: number,
      now: Date
    ): WhatsAppPendingOperationRecord | null {
      expireFallbackOperations(now, row => row.userId === userId);
      reviewAbandonedProcessingOperations(now, row => row.userId === userId);
      const reviewRequired = [...fallbackStore.values()]
        .filter(row => row.userId === userId && row.state === "review_required")
        .sort((a, b) => b.id - a.id)[0];
      if (reviewRequired) return reviewRequired;
      const candidates = [...fallbackStore.values()]
        .filter(
          row =>
            row.userId === userId &&
            (row.state === "active" || row.state === "processing")
        )
        .sort((a, b) => b.id - a.id);
      return candidates[0] ?? null;
    },
    getActiveByType(
      userId: number,
      type: string,
      now: Date
    ): WhatsAppPendingOperationRecord | null {
      expireFallbackOperations(
        now,
        row => row.userId === userId && row.type === type
      );
      reviewAbandonedProcessingOperations(
        now,
        row => row.userId === userId && row.type === type
      );
      if (
        [...fallbackStore.values()].some(
          row => row.userId === userId && row.state === "review_required"
        )
      )
        return null;
      const candidates = [...fallbackStore.values()]
        .filter(
          row =>
            row.userId === userId && row.type === type && row.state === "active"
        )
        .sort((a, b) => b.id - a.id);
      return candidates[0] ?? null;
    },
    listActiveByType(
      userId: number,
      type: string,
      now: Date
    ): WhatsAppPendingOperationRecord[] {
      expireFallbackOperations(
        now,
        row => row.userId === userId && row.type === type
      );
      reviewAbandonedProcessingOperations(
        now,
        row => row.userId === userId && row.type === type
      );
      if (
        [...fallbackStore.values()].some(
          row => row.userId === userId && row.state === "review_required"
        )
      )
        return [];
      return [...fallbackStore.values()]
        .filter(
          row =>
            row.userId === userId && row.type === type && row.state === "active"
        )
        .sort((a, b) => b.id - a.id);
    },
    getLatest(
      userId: number,
      now: Date
    ): WhatsAppPendingOperationRecord | null {
      expireFallbackOperations(now, row => row.userId === userId);
      reviewAbandonedProcessingOperations(now, row => row.userId === userId);
      return (
        [...fallbackStore.values()]
          .filter(row => row.userId === userId)
          .sort((a, b) => b.id - a.id)[0] ?? null
      );
    },
    getById(id: number, now: Date): WhatsAppPendingOperationRecord | null {
      const row = fallbackStore.get(id);
      if (row) {
        expireFallbackOperation(row, now);
        reviewAbandonedProcessingOperations(
          now,
          candidate => candidate.id === id
        );
      }
      return row ?? null;
    },
    claim(id: number, expectedVersion: number, now: Date): boolean {
      const row = fallbackStore.get(id);
      if (row) expireFallbackOperation(row, now);
      if (!row || row.state !== "active" || row.version !== expectedVersion)
        return false;
      Object.assign(row, {
        state: "consumed",
        dedupeKey: null,
        version: expectedVersion + 1,
        consumedAt: now,
        updatedAt: now,
      });
      return true;
    },
    beginProcessing(
      id: number,
      expectedVersion: number,
      now: Date,
      leaseMs: number
    ): number | null {
      const row = fallbackStore.get(id);
      if (row) expireFallbackOperation(row, now);
      if (
        !row ||
        row.version !== expectedVersion ||
        new Date(row.expiresAt).getTime() < now.getTime()
      )
        return null;
      if (
        row.state === "processing" &&
        new Date(row.updatedAt).getTime() + leaseMs <= now.getTime()
      ) {
        Object.assign(row, {
          state: "review_required",
          dedupeKey: null,
          version: row.version + 1,
          updatedAt: now,
          consumedAt: now,
        });
        return null;
      }
      if (row.state !== "active") return null;
      const version = expectedVersion + 1;
      Object.assign(row, { state: "processing", version, updatedAt: now });
      return version;
    },
    finishProcessing(
      id: number,
      expectedVersion: number,
      state: "active" | "consumed" | "review_required",
      now: Date
    ): boolean {
      const row = fallbackStore.get(id);
      if (row) expireFallbackOperation(row, now);
      if (!row || row.state !== "processing" || row.version !== expectedVersion)
        return false;
      Object.assign(row, {
        state,
        version: expectedVersion + 1,
        updatedAt: now,
        ...(state === "active" ? {} : { dedupeKey: null }),
        ...(state === "consumed" || state === "review_required"
          ? { consumedAt: now }
          : {}),
      });
      return true;
    },
    transition(
      id: number,
      nextState: Exclude<WhatsAppPendingOperationState, "active">,
      now: Date = new Date()
    ): boolean {
      const row = fallbackStore.get(id);
      if (row) expireFallbackOperation(row, now);
      if (!row || row.state !== "active") return false;
      Object.assign(row, {
        state: nextState,
        dedupeKey: null,
        version: row.version + 1,
        updatedAt: now,
      });
      return true;
    },
    purgeInactive(operationalDays: number, now: Date): number {
      expireFallbackOperations(now);
      const cutoff = now.getTime() - operationalDays * 24 * 60 * 60 * 1000;
      let purged = 0;
      for (const [id, row] of fallbackStore.entries()) {
        if (
          row.state !== "active" &&
          row.state !== "processing" &&
          new Date(row.updatedAt).getTime() < cutoff
        ) {
          fallbackStore.delete(id);
          purged++;
        }
      }
      return purged;
    },
  };
}

export const whatsappPendingOperationMemoryFallback = createFallbackStore();
