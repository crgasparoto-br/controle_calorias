import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { mealFavorites, mealInferences, mealItems, mealMedia, meals } from "../../drizzle/schema";
import { foodCatalogDirectKey } from "../foodCatalogKeys";
import type { MealDraftItem } from "../nutritionEngine";
import { upsertHouseholdMeasurePreference, type BuiltHouseholdMeasurePreference } from "../householdMeasureResolutionPersistence";

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
  updateMealItem(input: {
    userId: number;
    meal: SavedMealRecord;
    itemIndex: number;
    updatedItem: MealDraftItem;
    mealLabel: string;
    occurredAt: number;
    resolvedCatalogIds: Map<string, number>;
  }): Promise<void>;
  moveMealItem(input: {
    userId: number;
    sourceMeal: SavedMealRecord;
    itemIndex: number;
    updatedItem: MealDraftItem;
    targetMeal: { mealLabel: string; occurredAt: number };
    resolvedCatalogIds: Map<string, number>;
  }): Promise<{ targetMealId: number } | null>;
  persistMealUpdateWithHouseholdMeasureLearning(input: {
    meal: { id: number; userId: number; mealLabel: string; notes?: string; confidence: number; occurredAt: number };
    items: MealDraftItem[];
    expectedOriginalItem: MealDraftItem;
    resolvedCatalogIds: Map<string, number>;
    learning: BuiltHouseholdMeasurePreference;
  }): Promise<"updated" | "stale" | "not_found" | "unsupported">;
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

function readMealItemResolution(value: string | null | undefined) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as { resolution?: MealDraftItem["resolution"] };
    return parsed?.resolution ?? undefined;
  } catch {
    return undefined;
  }
}

function buildMealItemValues(mealId: number, items: MealDraftItem[], resolvedCatalogIds: Map<string, number>) {
  return items.map(item => ({
    ...(() => {
      const enriched = item as MealDraftItem & {
        foodId?: number;
        grams?: number;
        caloriesKcal?: number;
        proteinG?: number;
        carbG?: number;
        fatG?: number;
        fiberG?: number | null;
        sodiumMg?: number | null;
        foodSnapshotJson?: string;
      };
      return {
        foodId: enriched.foodId ?? null,
        grams: enriched.grams ?? item.estimatedGrams,
        caloriesKcal: enriched.caloriesKcal ?? item.calories,
        proteinG: enriched.proteinG ?? item.protein,
        carbG: enriched.carbG ?? item.carbs,
        fatG: enriched.fatG ?? item.fat,
        fiberG: enriched.fiberG ?? null,
        sodiumMg: enriched.sodiumMg ?? null,
        foodSnapshotJson: enriched.foodSnapshotJson ?? (item.resolution
          ? JSON.stringify({ kind: "meal_item_resolution", resolution: item.resolution })
          : null),
      };
    })(),
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

async function assertMealBelongsToUser(tx: any, userId: number, mealId: number) {
  const rows = await tx
    .select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.userId, userId), eq(meals.id, mealId)))
    .limit(1);
  return rows.length > 0;
}

async function lockMealAndItems(tx: any, userId: number, mealId: number) {
  const lockedMeals = await tx
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), eq(meals.id, mealId)))
    .for("update")
    .limit(1);
  if (!lockedMeals.length) return null;

  const lockedItems = await tx
    .select()
    .from(mealItems)
    .where(eq(mealItems.mealId, mealId))
    .orderBy(asc(mealItems.id))
    .for("update")
    .limit(1000);
  return { meal: lockedMeals[0], items: lockedItems };
}

function assertMealItemSnapshot(currentItems: any[], expectedItems: MealDraftItem[]) {
  if (currentItems.length !== expectedItems.length) {
    throw new Error("A refeição foi alterada antes do salvamento. Recarregue os dados e tente novamente.");
  }
  currentItems.forEach((row, index) => {
    if (!samePersistedMealItem(row, expectedItems[index])) {
      throw new Error("A refeição foi alterada antes do salvamento. Recarregue os dados e tente novamente.");
    }
  });
}

function buildMealItemUpdate(item: MealDraftItem, resolvedCatalogIds: Map<string, number>) {
  const values = { ...buildMealItemValues(0, [item], resolvedCatalogIds)[0] } as Record<string, unknown>;
  const enriched = item as MealDraftItem & {
    foodId?: number;
    grams?: number;
    caloriesKcal?: number;
    proteinG?: number;
    carbG?: number;
    fatG?: number;
    fiberG?: number | null;
    sodiumMg?: number | null;
    foodSnapshotJson?: string;
  };
  delete values.mealId;
  for (const field of ["foodId", "grams", "caloriesKcal", "proteinG", "carbG", "fatG", "fiberG", "sodiumMg", "foodSnapshotJson"]) {
    delete values[field];
  }
  return {
    ...values,
    ...(enriched.foodId !== undefined ? { foodId: enriched.foodId } : {}),
    ...(enriched.grams !== undefined ? { grams: enriched.grams } : {}),
    ...(enriched.caloriesKcal !== undefined ? { caloriesKcal: enriched.caloriesKcal } : {}),
    ...(enriched.proteinG !== undefined ? { proteinG: enriched.proteinG } : {}),
    ...(enriched.carbG !== undefined ? { carbG: enriched.carbG } : {}),
    ...(enriched.fatG !== undefined ? { fatG: enriched.fatG } : {}),
    ...(enriched.fiberG !== undefined ? { fiberG: enriched.fiberG } : {}),
    ...(enriched.sodiumMg !== undefined ? { sodiumMg: enriched.sodiumMg } : {}),
    ...(enriched.foodSnapshotJson !== undefined ? { foodSnapshotJson: enriched.foodSnapshotJson } : {}),
  };
}

async function updateMealMetadataInTransaction(tx: any, input: {
  userId: number;
  mealId: number;
  mealLabel: string;
  occurredAt: number;
}) {
  await tx
    .update(meals)
    .set({ status: "draft" })
    .where(and(eq(meals.userId, input.userId), eq(meals.id, input.mealId)));
  await tx
    .update(meals)
    .set({
      mealLabel: input.mealLabel,
      occurredAt: new Date(input.occurredAt),
      updatedAt: new Date(),
      status: "confirmed",
    })
    .where(and(eq(meals.userId, input.userId), eq(meals.id, input.mealId)));
}

function samePersistedMealItem(row: any, expected: MealDraftItem) {
  const numericEqual = (actual: unknown, wanted: unknown) => {
    const a = Number(actual);
    const b = Number(wanted);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  };
  return String(row.foodName ?? "") === String(expected.foodName ?? "")
    && String(row.canonicalName ?? "") === String(expected.canonicalName ?? "")
    && String(row.foodCatalogId ?? "") === String(expected.foodCatalogId ?? "")
    && String(row.portionText ?? "") === String(expected.portionText ?? "")
    && String(row.unit ?? "") === String(expected.unit ?? "")
    && numericEqual(row.quantity, expected.quantity)
    && numericEqual(row.servings, expected.servings)
    && numericEqual(row.estimatedGrams, expected.estimatedGrams)
    && numericEqual(row.calories, expected.calories)
    && numericEqual(row.protein, expected.protein)
    && numericEqual(row.carbs, expected.carbs)
    && numericEqual(row.fat, expected.fat)
    && String(row.source ?? "") === String(expected.source ?? "");
}

async function replaceMealItemsInTransaction(
  tx: any,
  input: {
    meal: { id: number; userId: number; mealLabel: string; notes?: string; confidence: number; occurredAt: number };
    items: MealDraftItem[];
    resolvedCatalogIds: Map<string, number>;
  },
) {
  await tx
    .update(meals)
    .set({ status: "draft" })
    .where(and(eq(meals.userId, input.meal.userId), eq(meals.id, input.meal.id)));

  await tx.delete(mealItems).where(eq(mealItems.mealId, input.meal.id));
  if (input.items.length) {
    await tx.insert(mealItems).values(buildMealItemValues(input.meal.id, input.items, input.resolvedCatalogIds));
  }

  await tx
    .update(meals)
    .set({
      mealLabel: input.meal.mealLabel,
      notes: input.meal.notes ?? null,
      confidence: input.meal.confidence,
      occurredAt: new Date(input.meal.occurredAt),
      updatedAt: new Date(),
      status: "confirmed",
    })
    .where(and(eq(meals.userId, input.meal.userId), eq(meals.id, input.meal.id)));
}

async function insertConfirmedMealInTransaction(tx: any, input: {
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
}) {
  const mealInsert = await tx.insert(meals).values({
    userId: input.meal.userId,
    source: input.meal.source,
    status: "draft",
    mealLabel: input.meal.mealLabel,
    notes: input.meal.notes ?? null,
    sourceText: input.meal.sourceText || null,
    transcript: input.meal.transcript ?? null,
    confidence: input.meal.confidence,
    occurredAt: new Date(input.meal.occurredAt),
  });
  const mealId = Number((mealInsert as any)?.[0]?.insertId ?? (mealInsert as any)?.insertId ?? 0);
  if (!mealId) {
    throw new Error("Não foi possível obter o id da refeição criada.");
  }

  if (input.items.length) {
    await tx.insert(mealItems).values(buildMealItemValues(mealId, input.items, input.resolvedCatalogIds));
  }

  if (input.media.length) {
    await tx.insert(mealMedia).values(input.media.map(item => ({
      mealId,
      mediaType: item.mediaType,
      storageKey: item.storageKey,
      storageUrl: item.storageUrl,
      mimeType: item.mimeType,
      originalFileName: item.originalFileName ?? null,
    })));
  }

  await tx.update(meals).set({ status: "confirmed" }).where(eq(meals.id, mealId));
  return mealId;
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
          db.select().from(mealItems).where(inArray(mealItems.mealId, mealIds)).orderBy(asc(mealItems.id)),
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
            resolution: readMealItemResolution(item.foodSnapshotJson),
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
        const ownsMeal = await assertMealBelongsToUser(tx, meal.userId, meal.id);
        if (!ownsMeal) return;
        await replaceMealItemsInTransaction(tx, { meal, items, resolvedCatalogIds });
      });
    },

    async updateMealItem({ userId, meal, itemIndex, updatedItem, mealLabel, occurredAt, resolvedCatalogIds }) {
      const db = await deps.getDb();
      if (!db) return;
      if (typeof db.transaction !== "function") {
        throw new Error("A edição de item exige suporte transacional no banco.");
      }

      await db.transaction(async (tx: any) => {
        const locked = await lockMealAndItems(tx, userId, meal.id);
        if (!locked) throw new Error("Refeição não encontrada.");
        assertMealItemSnapshot(locked.items, meal.items);
        if (itemIndex < 0 || itemIndex >= locked.items.length) {
          throw new Error("Alimento não encontrado na refeição.");
        }

        await updateMealMetadataInTransaction(tx, {
          userId,
          mealId: meal.id,
          mealLabel,
          occurredAt,
        });
        await tx
          .update(mealItems)
          .set(buildMealItemUpdate(updatedItem, resolvedCatalogIds))
          .where(and(eq(mealItems.id, locked.items[itemIndex].id), eq(mealItems.mealId, meal.id)));
      });
    },

    async moveMealItem({ userId, sourceMeal, itemIndex, updatedItem, targetMeal, resolvedCatalogIds }) {
      const db = await deps.getDb();
      if (!db) return null;
      if (typeof db.transaction !== "function") {
        throw new Error("A movimentação de item exige suporte transacional no banco.");
      }

      const targetMealId = await db.transaction(async (tx: any) => {
        const locked = await lockMealAndItems(tx, userId, sourceMeal.id);
        if (!locked) throw new Error("Refeição não encontrada.");
        assertMealItemSnapshot(locked.items, sourceMeal.items);
        if (itemIndex < 0 || itemIndex >= locked.items.length) {
          throw new Error("Alimento não encontrado na refeição.");
        }

        const createdMealId = await insertConfirmedMealInTransaction(tx, {
          meal: {
            userId,
            source: "web",
            mealLabel: targetMeal.mealLabel,
            sourceText: "Registro manual",
            confidence: 1,
            occurredAt: targetMeal.occurredAt,
          },
          items: [],
          media: [],
          resolvedCatalogIds,
        });

        await tx
          .update(mealItems)
          .set({
            mealId: createdMealId,
            ...buildMealItemUpdate(updatedItem, resolvedCatalogIds),
          })
          .where(and(eq(mealItems.id, locked.items[itemIndex].id), eq(mealItems.mealId, sourceMeal.id)));

        return createdMealId;
      });

      return { targetMealId };
    },

    async persistMealUpdateWithHouseholdMeasureLearning({ meal, items, expectedOriginalItem, resolvedCatalogIds, learning }) {
      const db = await deps.getDb();
      if (!db || typeof db.transaction !== "function") return "unsupported";

      return db.transaction(async (tx: any) => {
        if (learning.record.kind !== "user_learned") {
          throw new Error("Household measure learning mutation requires user_learned provenance.");
        }

        const lockedMeals = await tx
          .select({ id: meals.id, userId: meals.userId })
          .from(meals)
          .where(and(eq(meals.userId, meal.userId), eq(meals.id, meal.id)))
          .for("update")
          .limit(1);
        if (!lockedMeals.length) return "not_found" as const;
        if (Number(lockedMeals[0].userId) !== meal.userId) return "not_found" as const;

        const currentItems = await tx.select().from(mealItems).where(eq(mealItems.mealId, meal.id));
        const matchingItems = currentItems.filter((row: unknown) => samePersistedMealItem(row, expectedOriginalItem));
        if (matchingItems.length !== 1) return "stale" as const;

        await replaceMealItemsInTransaction(tx, { meal, items, resolvedCatalogIds });
        await upsertHouseholdMeasurePreference(tx, { userId: meal.userId, ...learning });
        return "updated" as const;
      });
    },

    async deleteMeal(userId, mealId) {
      const db = await deps.getDb();
      if (!db) return;

      await runInTransaction(db, async tx => {
        const ownsMeal = await assertMealBelongsToUser(tx, userId, mealId);
        if (!ownsMeal) return;

        await tx.delete(mealItems).where(eq(mealItems.mealId, mealId));
        await tx.delete(mealMedia).where(eq(mealMedia.mealId, mealId));
        await tx.delete(meals).where(and(eq(meals.userId, userId), eq(meals.id, mealId)));
      });
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
