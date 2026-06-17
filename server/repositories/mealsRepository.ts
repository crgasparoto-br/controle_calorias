import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { mealFavorites, mealInferences, mealItems, mealMedia, meals } from "../../drizzle/schema";
import type { MealDraftItem } from "../nutritionEngine";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type SavedMediaRecord = {
  id: number;
  mediaType: "image" | "audio";
  storageKey: string;
  storageUrl: string;
  mimeType: string;
  originalFileName?: string;
};

export type SavedMealRecord = {
  id: number;
  userId: number;
  source: "web" | "whatsapp";
  mealLabel: string;
  status: "confirmed";
  occurredAt: number;
  notes?: string;
  sourceText: string;
  transcript?: string;
  confidence: number;
  items: MealDraftItem[];
  media: SavedMediaRecord[];
  createdAt: number;
};

export type MealLoadRange = {
  startAt?: Date;
  endAt?: Date;
  includeMedia?: boolean;
};

export type MealsRepository = {
  findConfirmedByUserId(userId: number, options?: MealLoadRange): Promise<SavedMealRecord[] | null>;
  insertMeal(meal: {
    userId: number;
    source: "web" | "whatsapp";
    status: "confirmed";
    mealLabel: string;
    notes?: string;
    sourceText: string;
    transcript?: string;
    confidence: number;
    occurredAt: number;
  }): Promise<number>;
  insertMealItems(mealId: number, items: MealDraftItem[], resolvedCatalogIds: Map<string, number>): Promise<void>;
  insertMealMedia(mealId: number, media: SavedMediaRecord[]): Promise<void>;
  updateMeal(meal: { id: number; userId: number; mealLabel: string; notes?: string; confidence: number; occurredAt: number }): Promise<void>;
  replaceMealItems(mealId: number, items: MealDraftItem[], resolvedCatalogIds: Map<string, number>): Promise<void>;
  deleteMeal(userId: number, mealId: number): Promise<void>;
  findItemsWithMealDates(userId: number): Promise<Array<{ canonicalName: string; foodName: string; occurredAt: number }>>;
  insertInference(draft: {
    draftId: string;
    userId: number;
    source: "web" | "whatsapp";
    sourceText: string;
    transcript?: string;
    media: SavedMediaRecord[];
    reasoning: string;
    confidence: number;
    items: unknown;
    totals: unknown;
  }): Promise<void>;
  findInferenceByDraftId(draftId: string): Promise<typeof mealInferences.$inferSelect | undefined>;
  findFavoritesByUserId(userId: number): Promise<Array<typeof mealFavorites.$inferSelect>>;
  upsertFavorite(input: { userId: number; name: string; mealLabel: string; notes?: string; itemsJson: string }): Promise<void>;
  countConfirmed(): Promise<number>;
};

function buildMealItemValues(mealId: number, items: MealDraftItem[], resolvedCatalogIds: Map<string, number>) {
  return items.map(item => ({
    mealId,
    foodCatalogId: resolvedCatalogIds.get(item.canonicalName) ?? resolvedCatalogIds.get(item.foodName) ?? null,
    foodName: item.foodName,
    canonicalName: item.canonicalName,
    portionText: item.portionText,
    quantity: item.quantity,
    unit: item.unit,
    servings: item.servings,
    estimatedGrams: item.estimatedGrams,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    source: item.source,
  }));
}

export function createDrizzleMealsRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): MealsRepository {
  return {
    async findConfirmedByUserId(userId, options = {}) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const predicates = [
          eq(meals.userId, userId),
          eq(meals.status, "confirmed"),
          ...(options.startAt ? [gte(meals.occurredAt, options.startAt)] : []),
          ...(options.endAt ? [lt(meals.occurredAt, options.endAt)] : []),
        ];
        const mealRows = await db.select().from(meals).where(and(...predicates)).orderBy(desc(meals.occurredAt));
        if (!mealRows.length) return [];

        const mealIds = mealRows.map((row: { id: number }) => row.id);
        const includeMedia = options.includeMedia ?? true;
        const [itemRows, mediaRows] = await Promise.all([
          db.select().from(mealItems).where(inArray(mealItems.mealId, mealIds)),
          includeMedia ? db.select().from(mealMedia).where(inArray(mealMedia.mealId, mealIds)) : Promise.resolve([]),
        ]);

        const itemsByMealId = new Map<number, MealDraftItem[]>();
        for (const item of itemRows) {
          const list = itemsByMealId.get(item.mealId) ?? [];
          list.push({
            foodName: item.foodName,
            canonicalName: item.canonicalName,
            portionText: item.portionText,
            quantity: item.quantity,
            unit: item.unit,
            servings: item.servings,
            estimatedGrams: item.estimatedGrams,
            calories: item.calories,
            protein: item.protein,
            carbs: item.carbs,
            fat: item.fat,
            confidence: 0.9,
            source: item.source,
          });
          itemsByMealId.set(item.mealId, list);
        }

        const mediaByMealId = new Map<number, SavedMediaRecord[]>();
        for (const media of mediaRows) {
          const list = mediaByMealId.get(media.mealId) ?? [];
          list.push({
            id: media.id,
            mediaType: media.mediaType,
            storageKey: media.storageKey,
            storageUrl: media.storageUrl,
            mimeType: media.mimeType,
            originalFileName: media.originalFileName ?? undefined,
          });
          mediaByMealId.set(media.mealId, list);
        }

        const builtMeals = mealRows.map((row: typeof meals.$inferSelect) => ({
          id: row.id,
          userId: row.userId,
          source: row.source,
          mealLabel: row.mealLabel,
          status: "confirmed" as const,
          occurredAt: new Date(row.occurredAt).getTime(),
          notes: row.notes ?? undefined,
          sourceText: row.sourceText ?? "",
          transcript: row.transcript ?? undefined,
          confidence: row.confidence,
          items: itemsByMealId.get(row.id) ?? [],
          media: mediaByMealId.get(row.id) ?? [],
          createdAt: new Date(row.createdAt).getTime(),
        } satisfies SavedMealRecord));

        builtMeals.sort((a: SavedMealRecord, b: SavedMealRecord) => b.occurredAt - a.occurredAt);
        return builtMeals;
      } catch (error) {
        deps.onWarning("Meal read skipped", error);
        return null;
      }
    },

    async insertMeal(meal) {
      const db = await deps.getDb();
      if (!db) return 0;

      const mealInsert = await db.insert(meals).values({
        userId: meal.userId,
        source: meal.source,
        status: meal.status,
        mealLabel: meal.mealLabel,
        notes: meal.notes ?? null,
        sourceText: meal.sourceText || null,
        transcript: meal.transcript ?? null,
        confidence: meal.confidence,
        occurredAt: new Date(meal.occurredAt),
      });

      return Number((mealInsert as any)?.[0]?.insertId ?? (mealInsert as any)?.insertId ?? 0);
    },

    async insertMealItems(mealId, items, resolvedCatalogIds) {
      if (!items.length) return;
      const db = await deps.getDb();
      if (!db) return;

      await db.insert(mealItems).values(buildMealItemValues(mealId, items, resolvedCatalogIds));
    },

    async insertMealMedia(mealId, media) {
      if (!media.length) return;
      const db = await deps.getDb();
      if (!db) return;

      await db.insert(mealMedia).values(
        media.map(item => ({
          mealId,
          mediaType: item.mediaType,
          storageKey: item.storageKey,
          storageUrl: item.storageUrl,
          mimeType: item.mimeType,
          originalFileName: item.originalFileName ?? null,
        })),
      );
    },

    async updateMeal(meal) {
      const db = await deps.getDb();
      if (!db) return;

      await db
        .update(meals)
        .set({
          mealLabel: meal.mealLabel,
          notes: meal.notes ?? null,
          confidence: meal.confidence,
          occurredAt: new Date(meal.occurredAt),
          updatedAt: new Date(),
        })
        .where(and(eq(meals.userId, meal.userId), eq(meals.id, meal.id)));
    },

    async replaceMealItems(mealId, items, resolvedCatalogIds) {
      const db = await deps.getDb();
      if (!db) return;

      await db.delete(mealItems).where(eq(mealItems.mealId, mealId));
      if (items.length) {
        await db.insert(mealItems).values(buildMealItemValues(mealId, items, resolvedCatalogIds));
      }
    },

    async deleteMeal(userId, mealId) {
      const db = await deps.getDb();
      if (!db) return;

      await db.delete(mealItems).where(eq(mealItems.mealId, mealId));
      await db.delete(mealMedia).where(eq(mealMedia.mealId, mealId));
      await db.delete(meals).where(and(eq(meals.userId, userId), eq(meals.id, mealId)));
    },

    async findItemsWithMealDates(userId) {
      const db = await deps.getDb();
      if (!db) return [];

      const mealRows = await db.select().from(meals).where(eq(meals.userId, userId));
      const results: Array<{ canonicalName: string; foodName: string; occurredAt: number }> = [];
      for (const meal of mealRows) {
        const items = await db.select().from(mealItems).where(eq(mealItems.mealId, meal.id));
        for (const item of items) {
          results.push({
            canonicalName: item.canonicalName,
            foodName: item.foodName,
            occurredAt: new Date(meal.occurredAt).getTime(),
          });
        }
      }
      return results;
    },

    async insertInference(draft) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db.insert(mealInferences).values({
          draftId: draft.draftId,
          userId: draft.userId,
          source: draft.source,
          requestSummary: draft.sourceText,
          sourceText: draft.sourceText,
          transcript: draft.transcript ?? null,
          mediaJson: JSON.stringify(draft.media),
          reasoning: draft.reasoning,
          confidence: draft.confidence,
          itemsJson: JSON.stringify(draft.items),
          totalsJson: JSON.stringify(draft.totals),
        });
      } catch (error) {
        try {
          await db.insert(mealInferences).values({
            userId: draft.userId,
            source: draft.source,
            requestSummary: draft.sourceText,
            reasoning: draft.reasoning,
            confidence: draft.confidence,
            itemsJson: JSON.stringify(draft.items),
            totalsJson: JSON.stringify(draft.totals),
          } as any);
        } catch (legacyError) {
          deps.onWarning("Inference persistence skipped", legacyError);
        }
      }
    },

    async findInferenceByDraftId(draftId) {
      const db = await deps.getDb();
      if (!db) return undefined;

      const rows = await db.select().from(mealInferences).where(eq(mealInferences.draftId, draftId)).limit(1);
      return rows[0] ?? undefined;
    },

    async findFavoritesByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return [];

      return await db.select().from(mealFavorites).where(eq(mealFavorites.userId, userId));
    },

    async upsertFavorite(input) {
      const db = await deps.getDb();
      if (!db) return;

      await db.insert(mealFavorites).values(input).onDuplicateKeyUpdate({
        set: {
          mealLabel: input.mealLabel,
          notes: input.notes ?? null,
          itemsJson: input.itemsJson,
        },
      });
    },

    async countConfirmed() {
      const db = await deps.getDb();
      if (!db) return 0;

      const rows = await db.select().from(meals);
      return rows.filter((row: { status: string }) => row.status === "confirmed").length;
    },
  };
}
