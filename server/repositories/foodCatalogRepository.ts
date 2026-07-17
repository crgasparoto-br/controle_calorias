import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { foodCatalog, foodFavorites } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type FoodCatalogRow = typeof foodCatalog.$inferSelect;

export type FoodCatalogInsertInput = {
  slug: string;
  name: string;
  aliases: string;
  brandName: string | null;
  foodType: "generic" | "branded";
  dataSource: string;
  servingLabel: string;
  servingUnit: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number | null;
  isFruit: number;
  isVegetable: number;
  isUltraProcessed: number;
  processingLevel?: FoodCatalogRow["processingLevel"];
  classificationSource?: string | null;
  classificationConfidence?: number | null;
  isUserCreated: number;
  createdByUserId: number;
};

export type FoodCatalogUpdateInput = Omit<
  FoodCatalogInsertInput,
  "slug" | "aliases" | "isUserCreated" | "createdByUserId"
>;

export type FoodCatalogRepository = {
  findAll(): Promise<FoodCatalogRow[]>;
  findActiveForUser?(userId: number): Promise<FoodCatalogRow[]>;
  findForResolution?(userId: number): Promise<FoodCatalogRow[]>;
  findByIdsForUser?(userId: number, ids: number[]): Promise<FoodCatalogRow[]>;
  findFavoriteIdsByUserId(userId: number): Promise<Set<number>>;
  upsertFavorite(userId: number, foodId: number): Promise<void>;
  deleteFavorite(userId: number, foodId: number): Promise<void>;
  insert(input: FoodCatalogInsertInput): Promise<number>;
  update(
    foodId: number,
    userId: number,
    input: FoodCatalogUpdateInput
  ): Promise<number>;
};

function extractAffectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  if (!candidate || typeof candidate !== "object") return 0;
  const affectedRows =
    "affectedRows" in candidate
      ? (candidate as { affectedRows: unknown }).affectedRows
      : "rowsAffected" in candidate
        ? (candidate as { rowsAffected: unknown }).rowsAffected
        : "rowCount" in candidate
          ? (candidate as { rowCount: unknown }).rowCount
          : 0;
  const parsed = Number(affectedRows);
  return Number.isFinite(parsed) ? parsed : 0;
}

function visibleScope(userId: number) {
  return or(
    isNull(foodCatalog.createdByUserId),
    eq(foodCatalog.createdByUserId, userId)
  );
}

export function createDrizzleFoodCatalogRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): FoodCatalogRepository {
  return {
    async findAll() {
      const db = await deps.getDb();
      if (!db) return [];
      return await db.select().from(foodCatalog);
    },

    async findActiveForUser(userId) {
      const db = await deps.getDb();
      if (!db) return [];
      return await db
        .select()
        .from(foodCatalog)
        .where(and(eq(foodCatalog.status, "active"), visibleScope(userId)));
    },

    async findForResolution(userId) {
      const db = await deps.getDb();
      if (!db) return [];
      return await db
        .select()
        .from(foodCatalog)
        .where(
          or(
            and(
              isNull(foodCatalog.createdByUserId),
              eq(foodCatalog.status, "active")
            ),
            eq(foodCatalog.createdByUserId, userId)
          )
        );
    },

    async findByIdsForUser(userId, ids) {
      const db = await deps.getDb();
      if (!db || !ids.length) return [];
      return await db
        .select()
        .from(foodCatalog)
        .where(and(inArray(foodCatalog.id, ids), visibleScope(userId)));
    },

    async findFavoriteIdsByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return new Set<number>();
      try {
        const rows = await db
          .select({ foodCatalogId: foodFavorites.foodCatalogId })
          .from(foodFavorites)
          .innerJoin(
            foodCatalog,
            eq(foodCatalog.id, foodFavorites.foodCatalogId)
          )
          .where(
            and(
              eq(foodFavorites.userId, userId),
              eq(foodCatalog.status, "active"),
              visibleScope(userId)
            )
          );
        return new Set(
          rows.map((row: { foodCatalogId: number }) => row.foodCatalogId)
        );
      } catch (error) {
        deps.onWarning("Food favorites read skipped", error);
        return new Set<number>();
      }
    },

    async upsertFavorite(userId, foodId) {
      const db = await deps.getDb();
      if (!db) return;
      const [visibleFood] = await db
        .select({ id: foodCatalog.id })
        .from(foodCatalog)
        .where(
          and(
            eq(foodCatalog.id, foodId),
            eq(foodCatalog.status, "active"),
            visibleScope(userId)
          )
        )
        .limit(1);
      if (!visibleFood) throw new Error("Alimento ativo não encontrado.");
      await db
        .insert(foodFavorites)
        .values({ userId, foodCatalogId: foodId })
        .onDuplicateKeyUpdate({ set: { userId } });
    },

    async deleteFavorite(userId, foodId) {
      const db = await deps.getDb();
      if (!db) return;
      await db
        .delete(foodFavorites)
        .where(
          and(
            eq(foodFavorites.userId, userId),
            eq(foodFavorites.foodCatalogId, foodId)
          )
        );
    },

    async insert(input) {
      const db = await deps.getDb();
      if (!db) return 0;
      const inserted = await db
        .insert(foodCatalog)
        .values({ ...input, status: "active" });
      return Number(
        (inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0
      );
    },

    async update(foodId, userId, input) {
      const db = await deps.getDb();
      if (!db) return 0;
      const updated = await db
        .update(foodCatalog)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(foodCatalog.id, foodId),
            eq(foodCatalog.createdByUserId, userId),
            eq(foodCatalog.isUserCreated, 1),
            eq(foodCatalog.status, "active")
          )
        );
      return extractAffectedRows(updated);
    },
  };
}
