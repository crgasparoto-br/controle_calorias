import { and, desc, eq, gte, inArray, like, lt, not, or, sql } from "drizzle-orm";
import { inferenceLogs } from "../../drizzle/schema";
type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;
export type LogsRepository = {
  insert(entry: { userId?: number | null; origin: string; status: string; eventType: string; detail: string }): Promise<void>;
  findRecent(limit: number): Promise<Array<typeof inferenceLogs.$inferSelect> | null>;
  findPage(input: LogsPageInput): Promise<LogsPage | null>;
  count(): Promise<number | null>;
  countByRange(input: { from: Date; to: Date; statuses: Array<"success" | "warning" | "error"> }): Promise<number | null>;
  deleteByUserId(userId: number): Promise<void>;
};
export type LogsPageInput = {
  from: Date;
  to: Date;
  search?: string;
  status?: "success" | "warning" | "error";
  origin?: "web" | "whatsapp" | "admin";
  eventTypeCategory?: "ai" | "meal" | "whatsapp" | "foods" | "water" | "exercise" | "system";
  offset: number;
  limit: number;
};
export type LogsPage = { rows: Array<typeof inferenceLogs.$inferSelect>; total: number; availableTotal: number };
const EVENT_CATEGORY_PATTERNS: Record<NonNullable<LogsPageInput["eventTypeCategory"]>, string[]> = {
  ai: ["ai.%", "%inference%"],
  meal: ["meal.%"],
  whatsapp: ["whatsapp.%"],
  foods: ["foods.%", "nutrition_label_candidate.%"],
  water: ["water.%"],
  exercise: ["exercise.%"],
  system: ["quick_edit.%", "professional.%", "billing.%", "usage.%"],
};
const NON_SYSTEM_EVENT_CATEGORY_PATTERNS = Object.entries(EVENT_CATEGORY_PATTERNS).filter(([category]) => category !== "system").flatMap(([, patterns]) => patterns);
function buildWhere(input: LogsPageInput, includeActivityFilters: boolean) {
  const conditions = [gte(inferenceLogs.createdAt, input.from), lt(inferenceLogs.createdAt, input.to)];
  if (!includeActivityFilters) return and(...conditions);
  if (input.search) conditions.push(or(like(inferenceLogs.eventType, `%${input.search.trim()}%`), like(inferenceLogs.detail, `%${input.search.trim()}%`))!);
  if (input.status) conditions.push(eq(inferenceLogs.status, input.status));
  if (input.origin) conditions.push(eq(inferenceLogs.origin, input.origin));
  if (input.eventTypeCategory) {
    const patterns = EVENT_CATEGORY_PATTERNS[input.eventTypeCategory];
    conditions.push(input.eventTypeCategory === "system" ? not(or(...NON_SYSTEM_EVENT_CATEGORY_PATTERNS.map(pattern => like(inferenceLogs.eventType, pattern)))!) : or(...patterns.map(pattern => like(inferenceLogs.eventType, pattern)))!);
  }
  return and(...conditions);
}
export function createDrizzleLogsRepository(deps: { getDb: DbProvider; onWarning: PersistenceWarningHandler }): LogsRepository {
  return {
    async insert(entry) {
      const db = await deps.getDb();
      if (!db) return;
      try {
        await db.insert(inferenceLogs).values({ userId: entry.userId ?? null, origin: entry.origin, status: entry.status, eventType: entry.eventType, detail: entry.detail });
      } catch (error) {
        deps.onWarning("Log persistence skipped", error);
      }
    },
    async findRecent(limit) {
      const db = await deps.getDb();
      if (!db) return null;
      try {
        return await db.select().from(inferenceLogs).orderBy(desc(inferenceLogs.createdAt)).limit(limit);
      } catch (error) {
        deps.onWarning("Log read skipped", error);
        return null;
      }
    },
    async findPage(input) {
      const db = await deps.getDb();
      if (!db) return null;
      try {
        const filteredWhere = buildWhere(input, true);
        const availableWhere = buildWhere(input, false);
        const [rows, totalResult, availableResult] = await Promise.all([
          db.select().from(inferenceLogs).where(filteredWhere).orderBy(desc(inferenceLogs.createdAt), desc(inferenceLogs.id)).limit(Math.max(1, Math.trunc(input.limit))).offset(Math.max(0, Math.trunc(input.offset))),
          db.select({ count: sql<number>`count(*)` }).from(inferenceLogs).where(filteredWhere),
          db.select({ count: sql<number>`count(*)` }).from(inferenceLogs).where(availableWhere),
        ]);
        return { rows, total: Number(totalResult[0]?.count ?? 0), availableTotal: Number(availableResult[0]?.count ?? 0) };
      } catch (error) {
        deps.onWarning("Log filtered read skipped", error);
        return null;
      }
    },
    async count() {
      const db = await deps.getDb();
      if (!db) return null;
      try {
        const result = await db.select({ count: sql<number>`count(*)` }).from(inferenceLogs);
        return Number(result[0]?.count ?? 0);
      } catch (error) {
        deps.onWarning("Log count skipped", error);
        return null;
      }
    },
    async countByRange(input) {
      const db = await deps.getDb();
      if (!db) return null;
      try {
        const result = await db.select({ count: sql<number>`count(*)` }).from(inferenceLogs).where(and(gte(inferenceLogs.createdAt, input.from), lt(inferenceLogs.createdAt, input.to), inArray(inferenceLogs.status, input.statuses)));
        return Number(result[0]?.count ?? 0);
      } catch (error) {
        deps.onWarning("Log range count skipped", error);
        return null;
      }
    },
    async deleteByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return;
      await db.delete(inferenceLogs).where(eq(inferenceLogs.userId, userId));
    },
  };
}
