import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { mealFavorites, mealInferences, mealItems, mealMedia, meals } from "../../drizzle/schema";
import { foodCatalogDirectKey } from "../foodCatalogKeys";
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
  persistMeal(input: {
    meal: {
      userId: number;
      source: "web" | "whatsapp";
      mealLabel: string;
      notes?: string;
      sourceText: string;
      transcript?: string;
      confidence: number;
      occurredAt: number;
    };
    items: MealDraftItem[];
    media: SavedMediaRecord[];
    resolvedCatalogIds: Map<string, number>;
  }): Promise<number>;
  persistMealUpdate(input: {
    meal: { id: number; userId: number; mealLabel: string; notes?: string; confidence: number; occurredAt: number };
    items: MealDraftItem[];
    resolvedCatalogIds: Map<string, number>;
  }): Promise<void>;
  deleteMeal(userId: number, mealId: number): Promise<void>;
  findItemsWithMealDates(userId: number): Promise<Array<{ canonicalName: string; foodName: string; foodCatalogId: number | null; occurredAt: number }>>;
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

function resolveMealItemFoodCatalogId(item: MealDraftItem, resolvedCatalogIds: Map<string, number>) {
  const directId = Number(item.foodCatalogId);
  if (Number.isFinite(directId) && directId > 0) {
    const resolvedDirectId = resolvedCatalogIds.get(foodCatalogDirectKey(directId));
    if (resolvedDirectId) return resolvedDirectId;
  }

  return resolvedCatalogIds.get(item.canonicalName) ?? resolvedCatalogIds.get(item.foodName) ?? null;
}

function buildMealItemValues(mealId: number, items: MealDraftItem[], resolvedCatalogIds: Map<string, number>) {
  return items.map(item => ({
    mealId,
    foodCatalogId: resolveMealItemFoodCatalogId(item, resolvedCatalogIds),
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

// Falls back to running directly against `db` when the connection doesn't
// expose `.transaction` (e.g. some memory-backed test doubles); the draft ->
// confirmed status flip below still prevents partial rows from surfacing.
async function runInTransaction<T>(db: any, fn: (tx: any) => Promise<T>): Promise<T> {
  if (typeof db.transaction === "function") {
    return db.transaction(fn);
  }
  return fn(db);
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
            foodCatalogId: item.foodCatalogId ?? null,
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

    async persistMeal({ meal, items, media, resolvedCatalogIds }) {
      const db = await deps.getDb();
      if (!db) return 0;

      return runInTransaction(db, async tx => {
        const mealInsert = await tx.insert(meals).values({
          userId: meal.userId,
          source: meal.source,
          status: "draft",
          mealLabel: meal.mealLabel,
          notes: meal.notes ?? null,
          sourceText: meal.sourceText || null,
          transcript: meal.transcript ?? null,
          confidence: meal.confidence,
          occurredAt: new Date(meal.occurredAt),
        });
        const mealId = Number((mealInsert as any)?.[0]?.insertId ?? (mealInsert as any)?.insertId ?? 0);

        if (items.length) {
          await tx.insert(mealItems).values(buildMealItemValues(mealId, items, resolvedCatalogIds));
        }

        if (media.length) {
          await tx.insert(mealMedia).values(
            media.map(item => ({
              mealId,
              mediaType: item.mediaType,
              storageKey: item.storageKey,
              storageUrl: item.storageUrl,
              mimeType: item.mimeType,
              originalFileName: item.originalFileName ?? null,
            })),
          );
        }

        await tx.update(meals).set({ status: "confirmed" }).where(eq(meals.id, mealId));

        return mealId;
      });
    },

    async persistMealUpdate({ meal, items, resolvedCatalogIds }) {
      const db = await deps.getDb();
      if (!db) return;

      await runInTransaction(db, async tx => {
        await tx
          .update(meals)
          .set({ status: "draft" })
          .where(and(eq(meals.userId, meal.userId), eq(meals.id, meal.id)));

        await tx.delete(mealItems).where(eq(mealItems.mealId, meal.id));
        if (items.length) {
          await tx.insert(mealItems).values(buildMealItemValues(meal.id, items, resolvedCatalogIds));
        }

        await tx
          .update(meals)
          .set({
            mealLabel: meal.mealLabel,
            notes: meal.notes ?? null,
            confidence: meal.confidence,
            occurredAt: new Date(meal.occurredAt),
            updatedAt: new Date(),
            status: "confirmed",
          })
          .where(and(eq(meals.userId, meal.userId), eq(meals.id, meal.id)));
      });
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

      const rows = await db
        .select({
          canonicalName: mealItems.canonicalName,
          foodName: mealItems.foodName,
          foodCatalogId: mealItems.foodCatalogId,
          occurredAt: meals.occurredAt,
        })
        .from(mealItems)
        .innerJoin(meals, eq(mealItems.mealId, meals.id))
        .where(eq(meals.userId, userId));

      return rows.map((row: { canonicalName: string; foodName: string; foodCatalogId: number | null; occurredAt: Date | number }) => ({
        canonicalName: row.canonicalName,
        foodName: row.foodName,
        foodCatalogId: row.foodCatalogId ?? null,
        occurredAt: new Date(row.occurredAt).getTime(),
      }));
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
            draftId: draft.draftId,
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
