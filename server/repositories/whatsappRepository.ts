import { desc, eq } from "drizzle-orm";
import { whatsappConnections } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type WhatsAppConnectionRecord = typeof whatsappConnections.$inferSelect;

export type WhatsAppRepository = {
  findAllByUserId(userId: number): Promise<WhatsAppConnectionRecord[]>;
  findAllByPhoneNumber(phoneNumber: string): Promise<WhatsAppConnectionRecord[]>;
  insert(input: { userId: number; phoneNumber: string; displayName: string | null }): Promise<number>;
  update(connectionId: number, input: { phoneNumber: string; displayName: string | null; status: "active" }): Promise<void>;
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
        return await db.select().from(whatsappConnections).where(eq(whatsappConnections.phoneNumber, phoneNumber));
      } catch (error) {
        deps.onWarning("WhatsApp connection lookup by phone skipped", error);
        return [];
      }
    },

    async insert(input) {
      const db = await deps.getDb();
      if (!db) return 0;

      const inserted = await db.insert(whatsappConnections).values({
        userId: input.userId,
        phoneNumber: input.phoneNumber,
        displayName: input.displayName,
        status: "active",
      });
      return Number((inserted as { insertId?: number }).insertId ?? 0);
    },

    async update(connectionId, input) {
      const db = await deps.getDb();
      if (!db) return;

      await db
        .update(whatsappConnections)
        .set({
          phoneNumber: input.phoneNumber,
          displayName: input.displayName,
          status: input.status,
        })
        .where(eq(whatsappConnections.id, connectionId));
    },

    async disable(connectionId) {
      const db = await deps.getDb();
      if (!db) return;

      await db.update(whatsappConnections).set({ status: "disabled" }).where(eq(whatsappConnections.id, connectionId));
    },
  };
}
