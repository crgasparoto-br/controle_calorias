import { and, desc, eq } from "drizzle-orm";
import { whatsappPendingOperations } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type WhatsAppPendingOperationRecord = typeof whatsappPendingOperations.$inferSelect;

export type WhatsAppPendingOperationState = "active" | "consumed" | "cancelled" | "expired" | "superseded";

export type CreatePendingOperationInput = {
  userId: number;
  type: string;
  target: unknown;
  origin: string;
  ttlMs: number;
  now?: Date;
};

export type ClaimPendingOperationInput = {
  id: number;
  expectedVersion: number;
};

export type WhatsAppPendingOperationRepository = {
  createPendingOperation(input: CreatePendingOperationInput): Promise<WhatsAppPendingOperationRecord | null>;
  getActivePendingOperation(userId: number, now?: Date): Promise<WhatsAppPendingOperationRecord | null>;
  claimPendingOperation(input: ClaimPendingOperationInput): Promise<{ claimed: boolean }>;
  cancelPendingOperation(id: number): Promise<{ cancelled: boolean }>;
  supersedePendingOperation(id: number): Promise<{ superseded: boolean }>;
};

function getMysqlAffectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const affectedRows = Number((candidate as { affectedRows?: number })?.affectedRows ?? 0);
  return Number.isFinite(affectedRows) ? affectedRows : 0;
}

async function transitionFromActive(
  db: any,
  id: number,
  nextState: Exclude<WhatsAppPendingOperationState, "active">,
): Promise<boolean> {
  const result = await db
    .update(whatsappPendingOperations)
    .set({ state: nextState })
    .where(and(eq(whatsappPendingOperations.id, id), eq(whatsappPendingOperations.state, "active")));
  return getMysqlAffectedRows(result) > 0;
}

/**
 * Sem banco configurado, degrada para memória do processo (mesma estratégia de
 * getUserWhatsappConnection em db.ts) em vez de perder a pendência silenciosamente.
 * Não garante consumo atômico entre instâncias nesse modo — só single-instance local.
 */
let fallbackNextId = 1;
const fallbackStore = new Map<number, WhatsAppPendingOperationRecord>();

function createFallbackStore() {
  return {
    create(input: CreatePendingOperationInput): WhatsAppPendingOperationRecord {
      const now = input.now ?? new Date();
      const record = {
        id: fallbackNextId++,
        userId: input.userId,
        type: input.type,
        target: input.target,
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
    getActive(userId: number, now: Date): WhatsAppPendingOperationRecord | null {
      const candidates = [...fallbackStore.values()]
        .filter(row => row.userId === userId && row.state === "active")
        .sort((a, b) => b.id - a.id);
      const latest = candidates[0];
      if (!latest) return null;
      if (new Date(latest.expiresAt).getTime() < now.getTime()) return null;
      return latest;
    },
    claim(id: number, expectedVersion: number): boolean {
      const row = fallbackStore.get(id);
      if (!row || row.state !== "active" || row.version !== expectedVersion) return false;
      Object.assign(row, { state: "consumed", version: expectedVersion + 1, consumedAt: new Date() });
      return true;
    },
    transition(id: number, nextState: Exclude<WhatsAppPendingOperationState, "active">): boolean {
      const row = fallbackStore.get(id);
      if (!row || row.state !== "active") return false;
      Object.assign(row, { state: nextState });
      return true;
    },
  };
}

const fallback = createFallbackStore();

export function createDrizzleWhatsAppPendingOperationRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WhatsAppPendingOperationRepository {
  return {
    async createPendingOperation(input) {
      const db = await deps.getDb();
      if (!db) return fallback.create(input);

      const now = input.now ?? new Date();

      try {
        const inserted = await db.insert(whatsappPendingOperations).values({
          userId: input.userId,
          type: input.type,
          target: input.target,
          origin: input.origin,
          state: "active",
          version: 1,
          expiresAt: new Date(now.getTime() + input.ttlMs),
        });
        const insertedId = Number((inserted as { insertId?: number }).insertId ?? 0);

        const [created] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(eq(whatsappPendingOperations.id, insertedId))
          .limit(1);

        return created ?? null;
      } catch (error) {
        deps.onWarning("WhatsApp pending operation create skipped", error);
        return null;
      }
    },

    async getActivePendingOperation(userId, now = new Date()) {
      const db = await deps.getDb();
      if (!db) return fallback.getActive(userId, now);

      try {
        const [row] = await db
          .select()
          .from(whatsappPendingOperations)
          .where(and(eq(whatsappPendingOperations.userId, userId), eq(whatsappPendingOperations.state, "active")))
          .orderBy(desc(whatsappPendingOperations.id))
          .limit(1);

        if (!row) return null;
        if (new Date(row.expiresAt).getTime() < now.getTime()) return null;

        return row;
      } catch (error) {
        deps.onWarning("WhatsApp pending operation read skipped", error);
        return null;
      }
    },

    async claimPendingOperation({ id, expectedVersion }) {
      const db = await deps.getDb();
      if (!db) return { claimed: fallback.claim(id, expectedVersion) };

      try {
        const result = await db
          .update(whatsappPendingOperations)
          .set({ state: "consumed", version: expectedVersion + 1, consumedAt: new Date() })
          .where(and(
            eq(whatsappPendingOperations.id, id),
            eq(whatsappPendingOperations.state, "active"),
            eq(whatsappPendingOperations.version, expectedVersion),
          ));

        return { claimed: getMysqlAffectedRows(result) > 0 };
      } catch (error) {
        deps.onWarning("WhatsApp pending operation claim skipped", error);
        return { claimed: false };
      }
    },

    async cancelPendingOperation(id) {
      const db = await deps.getDb();
      if (!db) return { cancelled: fallback.transition(id, "cancelled") };

      try {
        const cancelled = await transitionFromActive(db, id, "cancelled");
        return { cancelled };
      } catch (error) {
        deps.onWarning("WhatsApp pending operation cancel skipped", error);
        return { cancelled: false };
      }
    },

    async supersedePendingOperation(id) {
      const db = await deps.getDb();
      if (!db) return { superseded: fallback.transition(id, "superseded") };

      try {
        const superseded = await transitionFromActive(db, id, "superseded");
        return { superseded };
      } catch (error) {
        deps.onWarning("WhatsApp pending operation supersede skipped", error);
        return { superseded: false };
      }
    },
  };
}
