import { and, desc, eq, gt, gte, lt, ne, or } from "drizzle-orm";
import { whatsappPendingOperations } from "../../drizzle/schema";
import { canUseMemoryPersistenceFallback } from "./memoryFallback";
import { whatsappPendingOperationMemoryFallback as fallback } from "./whatsappPendingOperationFallback";
import {
  createPendingOperationProcessingMethods,
  expireExpiredPendingOperations,
  transitionAbandonedProcessingOperations,
} from "./whatsappPendingOperationLifecycle";
import {
  PENDING_OPERATION_PROCESSING_LEASE_MS,
  type CreatePendingOperationInput,
  type ClaimPendingOperationInput,
  type PersistenceMode,
  type RepositoryDependencies,
  type WhatsAppPendingOperationRecord,
  type WhatsAppPendingOperationRepository,
  type WhatsAppPendingOperationState,
} from "./whatsappPendingOperationTypes";

export { PENDING_OPERATION_PROCESSING_LEASE_MS } from "./whatsappPendingOperationTypes";
export type {
  ClaimPendingOperationInput,
  CreatePendingOperationInput,
  ProcessPendingOperationInput,
  WhatsAppPendingOperationRecord,
  WhatsAppPendingOperationRepository,
  WhatsAppPendingOperationState,
} from "./whatsappPendingOperationTypes";

function getMysqlAffectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const affectedRows = Number(
    (candidate as { affectedRows?: number })?.affectedRows ?? 0
  );
  return Number.isFinite(affectedRows) ? affectedRows : 0;
}

function getMysqlInsertId(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const insertId = Number((candidate as { insertId?: number })?.insertId);
  return Number.isInteger(insertId) && insertId > 0 ? insertId : null;
}

async function transitionFromActive(
  db: any,
  id: number,
  nextState: Exclude<WhatsAppPendingOperationState, "active">,
  now: Date
): Promise<boolean> {
  const result = await db
    .update(whatsappPendingOperations)
    .set({ state: nextState, dedupeKey: null, updatedAt: now })
    .where(
      and(
        eq(whatsappPendingOperations.id, id),
        eq(whatsappPendingOperations.state, "active"),
        gte(whatsappPendingOperations.expiresAt, now)
      )
    );
  return getMysqlAffectedRows(result) > 0;
}

async function resolvePersistenceMode(
  deps: RepositoryDependencies,
  scope: string
): Promise<PersistenceMode> {
  try {
    const db = await deps.getDb();
    if (db) return { kind: "database", db };
    if (canUseMemoryPersistenceFallback()) return { kind: "memory" };

    deps.onWarning(
      scope,
      new Error(
        "Database unavailable and memory persistence fallback is disabled."
      )
    );
    return { kind: "unavailable" };
  } catch (error) {
    deps.onWarning(scope, error);
    return { kind: "unavailable" };
  }
}

export function createDrizzleWhatsAppPendingOperationRepository(
  deps: RepositoryDependencies
): WhatsAppPendingOperationRepository {
  return {
    ...createPendingOperationProcessingMethods(
      deps,
      resolvePersistenceMode,
      fallback
    ),
    async createPendingOperation(input) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation create skipped"
      );
      if (persistence.kind === "memory") return fallback.create(input);
      if (persistence.kind === "unavailable") return null;
      const { db } = persistence;

      const now = input.now ?? new Date();

      try {
        if (input.dedupeKey) {
          await expireExpiredPendingOperations(db, now, {
            dedupeKey: input.dedupeKey,
          });
        }
        const inserted = await db.insert(whatsappPendingOperations).values({
          userId: input.userId,
          type: input.type,
          target: input.target,
          dedupeKey: input.dedupeKey ?? null,
          origin: input.origin,
          state: "active",
          version: 1,
          expiresAt: new Date(now.getTime() + input.ttlMs),
        });
        const insertedId = getMysqlInsertId(inserted);
        if (!insertedId) {
          deps.onWarning(
            "WhatsApp pending operation create returned invalid insert id",
            new Error("Invalid insert id returned by database driver.")
          );
          return null;
        }

        const [created] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(eq(whatsappPendingOperations.id, insertedId))
          .limit(1);

        return created ?? null;
      } catch (error) {
        if (input.dedupeKey) {
          try {
            const [existing] = await db
              .select()
              .from(whatsappPendingOperations)
              .where(
                and(
                  eq(whatsappPendingOperations.dedupeKey, input.dedupeKey),
                  eq(whatsappPendingOperations.state, "active"),
                  gte(whatsappPendingOperations.expiresAt, now)
                )
              )
              .orderBy(desc(whatsappPendingOperations.id))
              .limit(1);
            if (
              existing &&
              new Date(existing.expiresAt).getTime() >= now.getTime()
            ) {
              return existing;
            }
          } catch (lookupError) {
            deps.onWarning(
              "WhatsApp pending operation dedupe lookup skipped",
              lookupError
            );
          }
        }
        deps.onWarning("WhatsApp pending operation create skipped", error);
        return null;
      }
    },

    async getActivePendingOperation(userId, now = new Date()) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation read skipped"
      );
      if (persistence.kind === "memory") return fallback.getActive(userId, now);
      if (persistence.kind === "unavailable") return null;
      const { db } = persistence;

      try {
        await expireExpiredPendingOperations(db, now, { userId });
        await transitionAbandonedProcessingOperations(db, now, { userId });
        const [review] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(
            and(
              eq(whatsappPendingOperations.userId, userId),
              eq(whatsappPendingOperations.state, "review_required"),
              gte(whatsappPendingOperations.expiresAt, now)
            )
          )
          .orderBy(desc(whatsappPendingOperations.id))
          .limit(1);
        if (review) return review;

        const [row] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(
            and(
              eq(whatsappPendingOperations.userId, userId),
              or(
                eq(whatsappPendingOperations.state, "active"),
                eq(whatsappPendingOperations.state, "processing")
              ),
              gte(whatsappPendingOperations.expiresAt, now)
            )
          )
          .orderBy(desc(whatsappPendingOperations.id))
          .limit(1);

        if (!row) return null;
        if (
          row.state === "processing" &&
          new Date(row.updatedAt).getTime() +
            PENDING_OPERATION_PROCESSING_LEASE_MS <=
            now.getTime()
        ) {
          await transitionAbandonedProcessingOperations(db, now, {
            id: row.id,
          });
          const [current] = await db
            .select()
            .from(whatsappPendingOperations)
            .where(eq(whatsappPendingOperations.id, row.id))
            .limit(1);
          return current &&
            new Date(current.expiresAt).getTime() >= now.getTime()
            ? current
            : null;
        }
        return row;
      } catch (error) {
        deps.onWarning("WhatsApp pending operation read skipped", error);
        return null;
      }
    },

    async getActivePendingOperationByType(userId, type, now = new Date()) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation typed read skipped"
      );
      if (persistence.kind === "memory") {
        return fallback.getActiveByType(userId, type, now);
      }
      if (persistence.kind === "unavailable") return null;
      const { db } = persistence;

      try {
        await expireExpiredPendingOperations(db, now, { userId });
        await transitionAbandonedProcessingOperations(db, now, { userId });
        const [review] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(
            and(
              eq(whatsappPendingOperations.userId, userId),
              eq(whatsappPendingOperations.state, "review_required"),
              gte(whatsappPendingOperations.expiresAt, now)
            )
          )
          .limit(1);
        if (review) return null;
        const [row] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(
            and(
              eq(whatsappPendingOperations.userId, userId),
              eq(whatsappPendingOperations.type, type),
              eq(whatsappPendingOperations.state, "active"),
              gte(whatsappPendingOperations.expiresAt, now)
            )
          )
          .orderBy(desc(whatsappPendingOperations.id))
          .limit(1);

        if (!row) return null;
        return row;
      } catch (error) {
        deps.onWarning("WhatsApp pending operation typed read skipped", error);
        return null;
      }
    },

    async listActivePendingOperationsByType(userId, type, now = new Date()) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation typed list skipped"
      );
      if (persistence.kind === "memory") {
        return fallback.listActiveByType(userId, type, now);
      }
      if (persistence.kind === "unavailable") return [];
      const { db } = persistence;

      try {
        await expireExpiredPendingOperations(db, now, { userId });
        await transitionAbandonedProcessingOperations(db, now, { userId });
        const [review] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(
            and(
              eq(whatsappPendingOperations.userId, userId),
              eq(whatsappPendingOperations.state, "review_required"),
              gte(whatsappPendingOperations.expiresAt, now)
            )
          )
          .limit(1);
        if (review) return [];
        const rows = await db
          .select()
          .from(whatsappPendingOperations)
          .where(
            and(
              eq(whatsappPendingOperations.userId, userId),
              eq(whatsappPendingOperations.type, type),
              eq(whatsappPendingOperations.state, "active"),
              gte(whatsappPendingOperations.expiresAt, now)
            )
          )
          .orderBy(desc(whatsappPendingOperations.id))
          .limit(100);

        return rows;
      } catch (error) {
        deps.onWarning("WhatsApp pending operation typed list skipped", error);
        return [];
      }
    },

    async getLatestPendingOperation(userId, now = new Date()) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation latest read skipped"
      );
      if (persistence.kind === "memory") return fallback.getLatest(userId, now);
      if (persistence.kind === "unavailable") return null;
      const { db } = persistence;

      try {
        await expireExpiredPendingOperations(db, now, { userId });
        await transitionAbandonedProcessingOperations(db, now, { userId });
        const [row] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(eq(whatsappPendingOperations.userId, userId))
          .orderBy(desc(whatsappPendingOperations.id))
          .limit(1);
        return row ?? null;
      } catch (error) {
        deps.onWarning("WhatsApp pending operation latest read skipped", error);
        return null;
      }
    },

    async getPendingOperationById(id, now = new Date()) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation read by id skipped"
      );
      if (persistence.kind === "memory") return fallback.getById(id, now);
      if (persistence.kind === "unavailable") return null;
      const { db } = persistence;

      try {
        await expireExpiredPendingOperations(db, now, { id });
        await transitionAbandonedProcessingOperations(db, now, { id });
        const [row] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(eq(whatsappPendingOperations.id, id))
          .limit(1);
        return row ?? null;
      } catch (error) {
        deps.onWarning("WhatsApp pending operation read by id skipped", error);
        return null;
      }
    },

    async claimPendingOperation({ id, expectedVersion, now = new Date() }) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation claim skipped"
      );
      if (persistence.kind === "memory") {
        return { claimed: fallback.claim(id, expectedVersion, now) };
      }
      if (persistence.kind === "unavailable") return { claimed: false };
      const { db } = persistence;

      try {
        const result = await db
          .update(whatsappPendingOperations)
          .set({
            state: "consumed",
            dedupeKey: null,
            version: expectedVersion + 1,
            consumedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(whatsappPendingOperations.id, id),
              eq(whatsappPendingOperations.state, "active"),
              eq(whatsappPendingOperations.version, expectedVersion),
              gte(whatsappPendingOperations.expiresAt, now)
            )
          );

        const claimed = getMysqlAffectedRows(result) > 0;
        if (!claimed) await expireExpiredPendingOperations(db, now, { id });
        return { claimed };
      } catch (error) {
        deps.onWarning("WhatsApp pending operation claim skipped", error);
        return { claimed: false };
      }
    },

    async cancelPendingOperation(id, now = new Date()) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation cancel skipped"
      );
      if (persistence.kind === "memory") {
        return { cancelled: fallback.transition(id, "cancelled", now) };
      }
      if (persistence.kind === "unavailable") return { cancelled: false };
      const { db } = persistence;

      try {
        const cancelled = await transitionFromActive(db, id, "cancelled", now);
        return { cancelled };
      } catch (error) {
        deps.onWarning("WhatsApp pending operation cancel skipped", error);
        return { cancelled: false };
      }
    },

    async supersedePendingOperation(id, now = new Date()) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation supersede skipped"
      );
      if (persistence.kind === "memory") {
        return { superseded: fallback.transition(id, "superseded", now) };
      }
      if (persistence.kind === "unavailable") return { superseded: false };
      const { db } = persistence;

      try {
        const superseded = await transitionFromActive(
          db,
          id,
          "superseded",
          now
        );
        return { superseded };
      } catch (error) {
        deps.onWarning("WhatsApp pending operation supersede skipped", error);
        return { superseded: false };
      }
    },

    async purgeInactiveOperations(operationalDays, now = new Date()) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation purge skipped"
      );
      if (persistence.kind === "memory") {
        return fallback.purgeInactive(operationalDays, now);
      }
      if (persistence.kind === "unavailable") return 0;
      const { db } = persistence;

      const cutoff = new Date(
        now.getTime() - operationalDays * 24 * 60 * 60 * 1000
      );
      try {
        await expireExpiredPendingOperations(db, now);
        const result = await db
          .delete(whatsappPendingOperations)
          .where(
            and(
              ne(whatsappPendingOperations.state, "active"),
              ne(whatsappPendingOperations.state, "processing"),
              lt(whatsappPendingOperations.updatedAt, cutoff)
            )
          );
        return getMysqlAffectedRows(result);
      } catch (error) {
        deps.onWarning("WhatsApp pending operation purge skipped", error);
        return 0;
      }
    },
  };
}
