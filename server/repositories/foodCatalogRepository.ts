import { and, eq } from "drizzle-orm";
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
  isUserCreated: number;
  createdByUserId: number;
};

export type FoodCatalogUpdateInput = Omit<FoodCatalogInsertInput, "slug" | "aliases" | "isUserCreated" | "createdByUserId">;

export type FoodCatalogRepository = {
  findAll(): Promise<FoodCatalogRow[]>;
  findFavoriteIdsByUserId(userId: number): Promise<Set<number>>;
  upsertFavorite(userId: number, foodId: number): Promise<void>;
  deleteFavorite(userId: number, foodId: number): Promise<void>;
  insert(input: FoodCatalogInsertInput): Promise<number>;
  update(foodId: number, userId: number, input: FoodCatalogUpdateInput): Promise<void>;
};

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

    async findFavoriteIdsByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return new Set<number>();

      try {
        const rows = await db.select().from(foodFavorites).where(eq(foodFavorites.userId, userId));
        return new Set(rows.map((row: { foodCatalogId: number }) => row.foodCatalogId));
      } catch (error) {
        deps.onWarning("Food favorites read skipped", error);
        return new Set<number>();
      }
    },

    async upsertFavorite(userId, foodId) {
      const db = await deps.getDb();
      if (!db) return;

      await db.insert(foodFavorites).values({ userId, foodCatalogId: foodId }).onDuplicateKeyUpdate({ set: { userId } });
    },

    async deleteFavorite(userId, foodId) {
      const db = await deps.getDb();
      if (!db) return;

      await db.delete(foodFavorites).where(and(eq(foodFavorites.userId, userId), eq(foodFavorites.foodCatalogId, foodId)));
    },

    async insert(input) {
      const db = await deps.getDb();
      if (!db) return 0;

      const inserted = await db.insert(foodCatalog).values(input);
      return Number((inserted as any)?.[0]?.insertId ?? (inserted as any)?.insertId ?? 0);
    },

    async update(foodId, userId, input) {
      const db = await deps.getDb();
      if (!db) return;

      await db.update(foodCatalog).set({
        ...input,
        updatedAt: new Date(),
      }).where(and(eq(foodCatalog.id, foodId), eq(foodCatalog.createdByUserId, userId)));
    },
  };
}
