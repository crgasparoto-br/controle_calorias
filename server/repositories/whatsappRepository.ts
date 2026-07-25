import { and, desc, eq, ne, sql } from "drizzle-orm";
import { whatsappConnections } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type WhatsAppConnectionRecord = typeof whatsappConnections.$inferSelect;

export type WhatsAppRepository = {
  findAllByUserId(userId: number): Promise<WhatsAppConnectionRecord[]>;
  findAllByPhoneNumber(phoneNumber: string): Promise<WhatsAppConnectionRecord[]>;
  insert(input: {
    userId: number;
    phoneNumber: string;
    displayName: string | null;
  }): Promise<number>;
  update(
    connectionId: number,
    input: {
      phoneNumber: string;
      displayName: string | null;
      status: "active";
    }
  ): Promise<void>;
  disable(connectionId: number): Promise<void>;
};

export function createDrizzleWhatsAppRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WhatsAppRepository {
  return {
    async findAllByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return [];

      try {
        return await db
          .select()
          .from(whatsappConnections)
          .where(eq(whatsappConnections.userId, userId))
          .orderBy(desc(whatsappConnections.updatedAt));
      } catch (error) {
        deps.onWarning("WhatsApp connection read skipped", error);
        return [];
      }
    },

    async findAllByPhoneNumber(phoneNumber) {
      const db = await deps.getDb();
      if (!db) return [];

      try {
        return await db
          .select()
          .from(whatsappConnections)
          .where(eq(whatsappConnections.phoneNumber, phoneNumber));
      } catch (error) {
        deps.onWarning("WhatsApp connection lookup by phone skipped", error);
        return [];
      }
    },

    async insert(input) {
      const db = await deps.getDb();
      if (!db) return 0;

      return db.transaction(async (tx: any) => {
        await tx.execute(sql`
          UPDATE whatsappConnections
          SET status = 'disabled', activePhoneKey = NULL, updatedAt = NOW()
          WHERE userId = ${input.userId}
        `);
        const inserted = await tx.execute(sql`
          INSERT INTO whatsappConnections (
            userId, phoneNumber, activePhoneKey, displayName,
            status, createdAt, updatedAt
          ) VALUES (
            ${input.userId}, ${input.phoneNumber}, ${input.phoneNumber},
            ${input.displayName}, 'active', NOW(), NOW()
          )
        `);
        const header = Array.isArray(inserted) ? inserted[0] : inserted;
        return Number((header as { insertId?: number }).insertId ?? 0);
      });
    },

    async update(connectionId, input) {
      const db = await deps.getDb();
      if (!db) return;

      await db.transaction(async (tx: any) => {
        const [target] = await tx
          .select({ userId: whatsappConnections.userId })
          .from(whatsappConnections)
          .where(eq(whatsappConnections.id, connectionId))
          .limit(1);
        if (!target) return;

        await tx
          .update(whatsappConnections)
          .set({ status: "disabled" })
          .where(
            and(
              eq(whatsappConnections.userId, target.userId),
              ne(whatsappConnections.id, connectionId)
            )
          );
        await tx.execute(sql`
          UPDATE whatsappConnections
          SET status = 'disabled', activePhoneKey = NULL, updatedAt = NOW()
          WHERE userId = ${target.userId}
            AND id <> ${connectionId}
        `);
        await tx.execute(sql`
          UPDATE whatsappConnections
          SET phoneNumber = ${input.phoneNumber},
              activePhoneKey = ${input.phoneNumber},
              displayName = ${input.displayName},
              status = 'active', updatedAt = NOW()
          WHERE id = ${connectionId}
        `);
      });
    },

    async disable(connectionId) {
      const db = await deps.getDb();
      if (!db) return;

      await db.execute(sql`
        UPDATE whatsappConnections
        SET status = 'disabled', activePhoneKey = NULL, updatedAt = NOW()
        WHERE id = ${connectionId}
      `);
    },
  };
}
