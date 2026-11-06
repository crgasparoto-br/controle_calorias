import { and, desc, eq, gte, lt, or } from "drizzle-orm";
import { whatsappPendingOperations } from "../../drizzle/schema";
import {
  PENDING_OPERATION_PROCESSING_LEASE_MS,
  type ClaimPendingOperationInput,
  type PersistenceMode,
  type ProcessPendingOperationInput,
  type RepositoryDependencies,
  type WhatsAppPendingOperationRecord,
  type WhatsAppPendingOperationRepository,
} from "./whatsappPendingOperationTypes";
import { whatsappPendingOperationMemoryFallback } from "./whatsappPendingOperationFallback";

function getMysqlAffectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const affectedRows = Number(
    (candidate as { affectedRows?: number })?.affectedRows ?? 0
  );
  return Number.isFinite(affectedRows) ? affectedRows : 0;
}

async function transitionFromProcessing(
  db: any,
  id: number,
  expectedVersion: number,
  nextState: "active" | "consumed" | "review_required",
  now: Date
): Promise<boolean> {
  const result = await db
    .update(whatsappPendingOperations)
    .set({
      state: nextState,
      version: expectedVersion + 1,
      updatedAt: now,
      ...(nextState === "active" ? {} : { dedupeKey: null }),
      ...(nextState === "consumed" || nextState === "review_required"
        ? { consumedAt: now }
        : {}),
    })
    .where(
      and(
        eq(whatsappPendingOperations.id, id),
        eq(whatsappPendingOperations.state, "processing"),
        eq(whatsappPendingOperations.version, expectedVersion),
        gte(whatsappPendingOperations.expiresAt, now)
      )
    );
  return getMysqlAffectedRows(result) > 0;
}

type ExpiredOperationScope = {
  id?: number;
  userId?: number;
  type?: string;
  dedupeKey?: string;
};

async function expirePendingOperationRow(
  db: any,
  row: WhatsAppPendingOperationRecord,
  now: Date
) {
  if (
    row.state !== "active" &&
    row.state !== "processing" &&
    row.state !== "review_required"
  )
    return false;
  const result = await db
    .update(whatsappPendingOperations)
    .set({
      state: "expired",
      dedupeKey: null,
      version: row.version + 1,
      updatedAt: now,
    })
    .where(
      and(
        eq(whatsappPendingOperations.id, row.id),
        eq(whatsappPendingOperations.state, row.state),
        eq(whatsappPendingOperations.version, row.version),
        lt(whatsappPendingOperations.expiresAt, now)
      )
    );
  return getMysqlAffectedRows(result) > 0;
}

export async function expireExpiredPendingOperations(
  db: any,
  now: Date,
  scope: ExpiredOperationScope = {}
): Promise<number> {
  let transitioned = 0;
  for (;;) {
    const conditions = [
      or(
        eq(whatsappPendingOperations.state, "active"),
        eq(whatsappPendingOperations.state, "processing"),
        eq(whatsappPendingOperations.state, "review_required")
      ),
      lt(whatsappPendingOperations.expiresAt, now),
      ...(scope.id !== undefined
        ? [eq(whatsappPendingOperations.id, scope.id)]
        : []),
      ...(scope.userId !== undefined
        ? [eq(whatsappPendingOperations.userId, scope.userId)]
        : []),
      ...(scope.type !== undefined
        ? [eq(whatsappPendingOperations.type, scope.type)]
        : []),
      ...(scope.dedupeKey !== undefined
        ? [eq(whatsappPendingOperations.dedupeKey, scope.dedupeKey)]
        : []),
    ];
    const rows = await db
      .select()
      .from(whatsappPendingOperations)
      .where(and(...conditions))
      .orderBy(desc(whatsappPendingOperations.id))
      .limit(100);
    if (!rows.length) break;

    let batchTransitions = 0;
    for (const row of rows as WhatsAppPendingOperationRecord[]) {
      if (await expirePendingOperationRow(db, row, now)) batchTransitions++;
    }
    transitioned += batchTransitions;
    if (batchTransitions === 0) break;
  }
  return transitioned;
}

export async function transitionAbandonedProcessingOperations(
  db: any,
  now: Date,
  scope: ExpiredOperationScope = {},
  leaseMs = PENDING_OPERATION_PROCESSING_LEASE_MS
): Promise<number> {
  const leaseBoundary = new Date(now.getTime() - leaseMs + 1);
  const conditions = [
    eq(whatsappPendingOperations.state, "processing"),
    lt(whatsappPendingOperations.updatedAt, leaseBoundary),
    gte(whatsappPendingOperations.expiresAt, now),
    ...(scope.id !== undefined
      ? [eq(whatsappPendingOperations.id, scope.id)]
      : []),
    ...(scope.userId !== undefined
      ? [eq(whatsappPendingOperations.userId, scope.userId)]
      : []),
    ...(scope.type !== undefined
      ? [eq(whatsappPendingOperations.type, scope.type)]
      : []),
  ];
  const rows = await db
    .select()
    .from(whatsappPendingOperations)
    .where(and(...conditions))
    .orderBy(desc(whatsappPendingOperations.id))
    .limit(100);
  let transitioned = 0;
  for (const row of rows as WhatsAppPendingOperationRecord[]) {
    if (
      await transitionFromProcessing(
        db,
        row.id,
        row.version,
        "review_required",
        now
      )
    )
      transitioned++;
  }
  return transitioned;
}

export type PersistenceModeResolver = (
  deps: RepositoryDependencies,
  scope: string
) => Promise<PersistenceMode>;

export function createPendingOperationProcessingMethods(
  deps: RepositoryDependencies,
  resolvePersistenceMode: PersistenceModeResolver,
  fallback: typeof whatsappPendingOperationMemoryFallback = whatsappPendingOperationMemoryFallback
): Pick<
  WhatsAppPendingOperationRepository,
  | "beginPendingOperationProcessing"
  | "completePendingOperationProcessing"
  | "releasePendingOperationProcessing"
  | "requirePendingOperationVerification"
> {
  return {
    async beginPendingOperationProcessing({
      id,
      expectedVersion,
      now = new Date(),
      leaseMs = PENDING_OPERATION_PROCESSING_LEASE_MS,
    }) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation processing claim skipped"
      );
      if (persistence.kind === "memory") {
        const version = fallback.beginProcessing(
          id,
          expectedVersion,
          now,
          leaseMs
        );
        return version ? { claimed: true, version } : { claimed: false };
      }
      if (persistence.kind === "unavailable") return { claimed: false };
      const { db } = persistence;
      try {
        const nextVersion = expectedVersion + 1;
        const active = await db
          .update(whatsappPendingOperations)
          .set({ state: "processing", version: nextVersion, updatedAt: now })
          .where(
            and(
              eq(whatsappPendingOperations.id, id),
              eq(whatsappPendingOperations.state, "active"),
              eq(whatsappPendingOperations.version, expectedVersion),
              gte(whatsappPendingOperations.expiresAt, now)
            )
          );
        if (getMysqlAffectedRows(active) > 0)
          return { claimed: true, version: nextVersion };
        await expireExpiredPendingOperations(db, now, { id });
        await transitionAbandonedProcessingOperations(db, now, { id }, leaseMs);
        return { claimed: false };
      } catch (error) {
        deps.onWarning(
          "WhatsApp pending operation processing claim skipped",
          error
        );
        return { claimed: false };
      }
    },

    async completePendingOperationProcessing({
      id,
      expectedVersion,
      now = new Date(),
    }) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation completion skipped"
      );
      if (persistence.kind === "memory")
        return {
          completed: fallback.finishProcessing(
            id,
            expectedVersion,
            "consumed",
            now
          ),
        };
      if (persistence.kind === "unavailable") return { completed: false };
      try {
        const completed = await transitionFromProcessing(
          persistence.db,
          id,
          expectedVersion,
          "consumed",
          now
        );
        if (!completed)
          await expireExpiredPendingOperations(persistence.db, now, { id });
        return { completed };
      } catch (error) {
        deps.onWarning("WhatsApp pending operation completion skipped", error);
        return { completed: false };
      }
    },

    async releasePendingOperationProcessing({
      id,
      expectedVersion,
      now = new Date(),
    }) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation processing release skipped"
      );
      if (persistence.kind === "memory")
        return {
          released: fallback.finishProcessing(
            id,
            expectedVersion,
            "active",
            now
          ),
        };
      if (persistence.kind === "unavailable") return { released: false };
      try {
        const released = await transitionFromProcessing(
          persistence.db,
          id,
          expectedVersion,
          "active",
          now
        );
        if (!released)
          await expireExpiredPendingOperations(persistence.db, now, { id });
        return { released };
      } catch (error) {
        deps.onWarning(
          "WhatsApp pending operation processing release skipped",
          error
        );
        return { released: false };
      }
    },

    async requirePendingOperationVerification({
      id,
      expectedVersion,
      now = new Date(),
    }) {
      const persistence = await resolvePersistenceMode(
        deps,
        "WhatsApp pending operation verification state skipped"
      );
      if (persistence.kind === "memory")
        return {
          required: fallback.finishProcessing(
            id,
            expectedVersion,
            "review_required",
            now
          ),
        };
      if (persistence.kind === "unavailable") return { required: false };
      try {
        const required = await transitionFromProcessing(
          persistence.db,
          id,
          expectedVersion,
          "review_required",
          now
        );
        if (!required)
          await expireExpiredPendingOperations(persistence.db, now, { id });
        return { required };
      } catch (error) {
        deps.onWarning(
          "WhatsApp pending operation verification state skipped",
          error
        );
        return { required: false };
      }
    },
  };
}
