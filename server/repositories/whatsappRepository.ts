import { and, desc, eq, ne } from "drizzle-orm";
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
        await tx
          .update(whatsappConnections)
          .set({ status: "disabled", activePhoneKey: null })
          .where(eq(whatsappConnections.userId, input.userId));
        const inserted = await tx.insert(whatsappConnections).values({
          userId: input.userId,
          phoneNumber: input.phoneNumber,
          activePhoneKey: input.phoneNumber,
          displayName: input.displayName,
          status: "active",
        });
        return Number((inserted as { insertId?: number }).insertId ?? 0);
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
          .set({ status: "disabled", activePhoneKey: null })
          .where(
            and(
              eq(whatsappConnections.userId, target.userId),
              ne(whatsappConnections.id, connectionId)
            )
          );
        await tx
          .update(whatsappConnections)
          .set({
            phoneNumber: input.phoneNumber,
            activePhoneKey: input.phoneNumber,
            displayName: input.displayName,
            status: input.status,
          })
          .where(eq(whatsappConnections.id, connectionId));
      });
    },

    async disable(connectionId) {
      const db = await deps.getDb();
      if (!db) return;

      await db
        .update(whatsappConnections)
        .set({ status: "disabled", activePhoneKey: null })
        .where(eq(whatsappConnections.id, connectionId));
    },
  };
}
