import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  mealFavorites,
  mealInferences,
  mealItems,
  mealMedia,
  meals,
} from "../../drizzle/schema";
import { foodD1OperationEffects, foodD1OperationRoutes } from "../../drizzle/food-intelligence-v2-schema";
import type { MealDraftItem } from "../nutritionEngine";
import type { BuiltHouseholdMeasurePreference } from "../householdMeasureResolutionPersistence";
import { upsertHouseholdMeasurePreference } from "../householdMeasureResolutionPersistence";
import { readConfirmedMealClassification } from "../modules/meals/classificationSnapshot";
import { readSavedMealAdjustmentIdentity } from "../modules/meals/commercialIdentitySnapshot";
import { assertLegacyMealItemMutationSafe, hasBoundFoodV2Snapshot } from "../modules/meals/foodV2Snapshot";
import {
  createMealMutationPreImage,
  groupRawMealItemsByMealId,
  persistMealUpdateWithPreImage,
} from "./mealMutationPreImage";
import {
  assertMealItemSnapshot,
  assertMealMetadataSnapshot,
  buildMealItemUpdate,
  buildMealItemValues,
  readMealItemResolution,
  sanitizeUnverifiedReplacement,
  samePersistedMealItem,
} from "./mealItemPersistence";
import {
  assertMealBelongsToUser,
  insertConfirmedMealInTransaction,
  lockMealAndItems,
  replaceMealItemsInTransaction,
  runInTransaction,
  updateMealMetadataInTransaction,
} from "./mealTransactionOperations";
import {
  guardHistoricalMealItemUpdate,
  sameHistoricalMealFood,
} from "./mealItemHistoryReconciliation";
import { requireFreshReplacementNutrition } from "./mealReplacementNutrition";

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
  /** Exact raw database pre-image; returned only by the internal adjustment read. */
  mutationPreImage?: string;
};

export type MealLoadRange = {
  startAt?: Date;
  endAt?: Date;
  includeMedia?: boolean;
  /** Only the isolated shadow historical projection opts into new metadata. */
  shadowReadOnly?: boolean;
  /** Internal projection for existing-meal adjustments only. */
  adjustmentRead?: boolean;
};

export type MealsRepository = {
  findConfirmedByUserId(
    userId: number,
    options?: MealLoadRange
  ): Promise<SavedMealRecord[] | null>;
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
    /** Optional D1 V1 receipt must be committed in the meal transaction. */
    legacyD1Receipt?: { operationKey: string; operationScopeHash: string; replayed: boolean };
  }): Promise<number>;
  persistMealUpdate(input: {
    meal: {
      id: number;
      userId: number;
      mealLabel: string;
      notes?: string;
      confidence: number;
      occurredAt: number;
    };
    items: MealDraftItem[];
    resolvedCatalogIds: Map<string, number>;
    expectedPreImage?: string;
  }): Promise<string | void>;
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
    meal: {
      id: number;
      userId: number;
      mealLabel: string;
      notes?: string;
      confidence: number;
      occurredAt: number;
    };
    items: MealDraftItem[];
    expectedOriginalItem: MealDraftItem;
    resolvedCatalogIds: Map<string, number>;
    learning: BuiltHouseholdMeasurePreference;
  }): Promise<"updated" | "stale" | "not_found" | "unsupported">;
  deleteMeal(userId: number, mealId: number): Promise<void>;
  findItemsWithMealDates(
    userId: number
  ): Promise<
    Array<{
      canonicalName: string;
      foodName: string;
      foodCatalogId: number | null;
      occurredAt: number;
    }>
  >;
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
  findInferenceByDraftId(
    draftId: string
  ): Promise<typeof mealInferences.$inferSelect | undefined>;
  findFavoritesByUserId(
    userId: number
  ): Promise<Array<typeof mealFavorites.$inferSelect>>;
  upsertFavorite(input: {
    userId: number;
    name: string;
    mealLabel: string;
    notes?: string;
    itemsJson: string;
  }): Promise<void>;
  countConfirmed(): Promise<number>;
};

import {
  assertMealItemSnapshot,
  assertMealMetadataSnapshot,
  buildMealItemUpdate,
  readMealItemResolution,
  sanitizeUnverifiedReplacement,
  samePersistedMealItem,
} from "./mealItemPersistence";
import {
  assertMealBelongsToUser,
  insertConfirmedMealInTransaction,
  lockMealAndItems,
  replaceMealItemsInTransaction,
  runInTransaction,
  updateMealMetadataInTransaction,
} from "./mealTransactionOperations";

/** One snapshot-only database reader; the public repository method is a facade. */
async function loadSavedMeals(
  deps: { getDb: DbProvider; onWarning: PersistenceWarningHandler },
  userId: number,
  options: MealLoadRange = {}
): ReturnType<MealsRepository["findConfirmedByUserId"]> {
  const db = await deps.getDb();
  if (!db) {
    if (options.adjustmentRead) {
      throw new Error("Persistent meal read unavailable for adjustment");
    }
    return null;
  }

  try {
    const predicates = [
      eq(meals.userId, userId),
      eq(meals.status, "confirmed"),
      ...(options.startAt ? [gte(meals.occurredAt, options.startAt)] : []),
      ...(options.endAt ? [lt(meals.occurredAt, options.endAt)] : []),
    ];
    const mealRows = await db
      .select()
      .from(meals)
      .where(and(...predicates))
      .orderBy(desc(meals.occurredAt));
    if (!mealRows.length) return [];

    const mealIds = mealRows.map((row: { id: number }) => row.id);
    const includeMedia = options.includeMedia ?? true;
    const [itemRows, mediaRows] = await Promise.all([
      db
        .select()
        .from(mealItems)
        .where(inArray(mealItems.mealId, mealIds))
        .orderBy(asc(mealItems.id)),
      includeMedia
        ? db.select().from(mealMedia).where(inArray(mealMedia.mealId, mealIds))
        : Promise.resolve([]),
    ]);

    const itemsByMealId = new Map<number, MealDraftItem[]>();
    const rawItemsByMealId = groupRawMealItemsByMealId(itemRows);
    for (const item of itemRows) {
      const list = itemsByMealId.get(item.mealId) ?? [];
      // Never promote an arbitrary legacy JSON note into V2 metadata.
      const v2Historical = hasBoundFoodV2Snapshot(item);
      list.push({
        foodCatalogId: item.foodCatalogId ?? null,
        // V1 rows retain the public DTO shape; a bound V2 snapshot is
        // historical in public reads as well as in explicit shadow reads.
        ...(options.shadowReadOnly || v2Historical
          ? {
              // A-006: a persisted V2 variant outranks its family and legacy
              // catalog identifier; never re-infer a missing variant by name.
              historicalRef:
                item.foodVariantId != null
                  ? "variant:" + item.foodVariantId
                  : item.foodId != null
                    ? "food:" + item.foodId
                    : item.foodCatalogId != null
                      ? "catalog:" + item.foodCatalogId
                      : null,
              classification: readConfirmedMealClassification(
                item.foodSnapshotJson
              ),
            }
          : {}),
        ...(v2Historical ? { v2SnapshotVerified: true as const } : {}),
        ...(options.adjustmentRead
          ? readSavedMealAdjustmentIdentity(item, item.foodSnapshotJson)
          : {}),
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
        sourceMediaStorageKey: item.sourceMediaStorageKey ?? undefined,
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

    const builtMeals = mealRows.map(
      (row: typeof meals.$inferSelect) =>
        ({
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
          ...(options.adjustmentRead
            ? {
                mutationPreImage: createMealMutationPreImage(
                  row,
                  rawItemsByMealId.get(row.id) ?? []
                ),
              }
            : {}),
        }) satisfies SavedMealRecord
    );

    builtMeals.sort(
      (a: SavedMealRecord, b: SavedMealRecord) => b.occurredAt - a.occurredAt
    );
    return builtMeals;
  } catch (error) {
    deps.onWarning("Meal read skipped", error);
    if (options.adjustmentRead) throw error;
    return null;
  }
}

export function createDrizzleMealsRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): MealsRepository {
  return {
    findConfirmedByUserId(userId, options = {}) {
      return loadSavedMeals(deps, userId, options);
    },

    async persistMeal({ meal, items, media, resolvedCatalogIds, legacyD1Receipt }) {
      const db = await deps.getDb();
      if (!db) {
        if (legacyD1Receipt) throw new Error("food-d1-legacy-receipt-db-unavailable");
        return 0;
      }
      if (legacyD1Receipt && typeof db.transaction !== "function") {
        throw new Error("food-d1-legacy-receipt-transaction-unavailable");
      }

      if (legacyD1Receipt) {
      return runInTransaction(db, async tx => {
        if (legacyD1Receipt) {
          if (typeof legacyD1Receipt.operationKey !== "string" ||
              legacyD1Receipt.operationKey.length > 200 ||
              !/^[a-f0-9]{64}$/.test(legacyD1Receipt.operationScopeHash)) {
            throw new Error("food-d1-legacy-receipt-malformed");
          }
          const [route] = await tx.select().from(foodD1OperationRoutes)
            .where(and(eq(foodD1OperationRoutes.ownerUserId, meal.userId),
              eq(foodD1OperationRoutes.operationKey, legacyD1Receipt.operationKey)))
            .for("update").limit(1);
          let routeVersions: unknown;
          try { routeVersions = JSON.parse(route?.revisionsJson ?? "null"); }
          catch { throw new Error("food-d1-legacy-receipt-corrupt-route"); }
          if (!route || route.resolver !== "v1" ||
              route.originEntrypoint !== "addition" ||
              !routeVersions || typeof routeVersions !== "object" ||
              (routeVersions as Record<string, unknown>).operationScopeHash !==
                legacyD1Receipt.operationScopeHash ||
              (["code", "knowledge", "lexicon", "policy", "resolver"] as const)
                .some(key => (routeVersions as Record<string, unknown>)[key] !== "legacy-v1")) {
            throw new Error("food-d1-legacy-receipt-unpinned-or-stale");
          }
          const [receipt] = await tx.select().from(foodD1OperationEffects)
            .where(and(eq(foodD1OperationEffects.ownerUserId, meal.userId),
              eq(foodD1OperationEffects.operationKey, legacyD1Receipt.operationKey),
              eq(foodD1OperationEffects.observationId, "__manual_v1_confirmed")))
            .for("update").limit(1);
          if (receipt) {
            if (receipt.decisionHash !== legacyD1Receipt.operationScopeHash) {
              throw new Error("food-d1-legacy-receipt-payload-changed");
            }
            let outcome: unknown;
            try { outcome = JSON.parse(receipt.outcomeJson); }
            catch { throw new Error("food-d1-legacy-receipt-corrupt"); }
            const id = (outcome as { mealId?: unknown } | null)?.mealId;
            if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
              throw new Error("food-d1-legacy-receipt-corrupt");
            }
            const [existing] = await tx.select().from(meals)
              .where(and(eq(meals.id, id), eq(meals.userId, meal.userId),
                eq(meals.status, "confirmed"))).for("update").limit(1);
            if (!existing) throw new Error("food-d1-legacy-receipt-meal-missing");
            legacyD1Receipt.replayed = true;
            return id;
          }
        }
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

        let itemInsertForReceipt: unknown = null;
        if (items.length) {
          itemInsertForReceipt = await tx.insert(mealItems).values(
            buildMealItemValues(mealId, items, resolvedCatalogIds),
          );
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
        if (legacyD1Receipt) {
          const firstItemId = Number((itemInsertForReceipt as any)?.[0]?.insertId ??
            (itemInsertForReceipt as any)?.insertId ?? 0);
          if (!Number.isSafeInteger(mealId) || mealId <= 0 ||
              !Number.isSafeInteger(firstItemId) || firstItemId <= 0) {
            throw new Error("food-d1-legacy-receipt-effect-id-unavailable");
          }
          await tx.insert(foodD1OperationEffects).values({
            ownerUserId: meal.userId, operationKey: legacyD1Receipt.operationKey,
            observationId: "__manual_v1_confirmed",
            decisionHash: legacyD1Receipt.operationScopeHash,
            outcomeJson: JSON.stringify({ mealId, itemId: firstItemId }),
          });
        }

        return mealId;
      });
      }
      return runInTransaction(db, tx =>
        insertConfirmedMealInTransaction(tx, {
          meal,
          items,
          media,
          resolvedCatalogIds,
        })
      );
    },
    async persistMealUpdate({
      meal,
      items,
      resolvedCatalogIds,
      expectedPreImage,
    }) {
      return persistMealUpdateWithPreImage({
        db: await deps.getDb(),
        meal,
        items,
        resolvedCatalogIds,
        expectedPreImage,
        runInTransaction,
        lockMealAndItems,
        replaceMealItemsInTransaction: async (tx, update, previous) => {
          assertLegacyMealItemMutationSafe(previous);
          await replaceMealItemsInTransaction(tx, update, previous);
        },
      });
    },

    async updateMealItem({
      userId,
      meal,
      itemIndex,
      updatedItem,
      mealLabel,
      occurredAt,
      resolvedCatalogIds,
    }) {
      const db = await deps.getDb();
      if (!db) return;
      if (typeof db.transaction !== "function") {
        throw new Error(
          "A edição de item exige suporte transacional no banco."
        );
      }

      await db.transaction(async (tx: any) => {
        const locked = await lockMealAndItems(tx, userId, meal.id);
        if (!locked) throw new Error("Refeição não encontrada.");
        assertMealMetadataSnapshot(locked.meal, meal);
        assertMealItemSnapshot(locked.items, meal.items);
        if (itemIndex < 0 || itemIndex >= locked.items.length) {
          throw new Error("Alimento não encontrado na refeição.");
        }
        assertLegacyMealItemMutationSafe([locked.items[itemIndex]]);

        await updateMealMetadataInTransaction(tx, {
          userId,
          mealId: meal.id,
          mealLabel,
          occurredAt,
        });
        const previous = locked.items[itemIndex];
        const sameIdentity = sameHistoricalMealFood(previous, updatedItem);
        const safeItem = sameIdentity
          ? updatedItem
          : sanitizeUnverifiedReplacement(updatedItem);
        const guarded = guardHistoricalMealItemUpdate(
          previous,
          safeItem,
          buildMealItemUpdate(
            safeItem,
            resolvedCatalogIds,
            previous.foodSnapshotJson
          )
        );
        const values = sameIdentity
          ? guarded
          : await requireFreshReplacementNutrition(
              tx,
              userId,
              [previous],
              updatedItem,
              resolvedCatalogIds,
              guarded
            );
        await tx
          .update(mealItems)
          .set(values)
          .where(
            and(eq(mealItems.id, previous.id), eq(mealItems.mealId, meal.id))
          );
      });
    },

    async moveMealItem({
      userId,
      sourceMeal,
      itemIndex,
      updatedItem,
      targetMeal,
      resolvedCatalogIds,
    }) {
      const db = await deps.getDb();
      if (!db) return null;
      if (typeof db.transaction !== "function") {
        throw new Error(
          "A movimentação de item exige suporte transacional no banco."
        );
      }

      const targetMealId = await db.transaction(async (tx: any) => {
        const locked = await lockMealAndItems(tx, userId, sourceMeal.id);
        if (!locked) throw new Error("Refeição não encontrada.");
        assertMealMetadataSnapshot(locked.meal, sourceMeal);
        assertMealItemSnapshot(locked.items, sourceMeal.items);
        if (itemIndex < 0 || itemIndex >= locked.items.length) {
          throw new Error("Alimento não encontrado na refeição.");
        }
        assertLegacyMealItemMutationSafe([locked.items[itemIndex]]);

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

        const previous = locked.items[itemIndex];
        const sameIdentity = sameHistoricalMealFood(previous, updatedItem);
        const safeItem = sameIdentity
          ? updatedItem
          : sanitizeUnverifiedReplacement(updatedItem);
        const guarded = guardHistoricalMealItemUpdate(
          previous,
          safeItem,
          buildMealItemUpdate(
            safeItem,
            resolvedCatalogIds,
            previous.foodSnapshotJson
          )
        );
        const values = sameIdentity
          ? guarded
          : await requireFreshReplacementNutrition(
              tx,
              userId,
              [previous],
              updatedItem,
              resolvedCatalogIds,
              guarded
            );
        await tx
          .update(mealItems)
          .set({ mealId: createdMealId, ...values })
          .where(
            and(
              eq(mealItems.id, previous.id),
              eq(mealItems.mealId, sourceMeal.id)
            )
          );

        return createdMealId;
      });

      return { targetMealId };
    },

    async persistMealUpdateWithHouseholdMeasureLearning({
      meal,
      items,
      expectedOriginalItem,
      resolvedCatalogIds,
      learning,
    }) {
      const db = await deps.getDb();
      if (!db || typeof db.transaction !== "function") return "unsupported";

      return db.transaction(async (tx: any) => {
        if (learning.record.kind !== "user_learned") {
          throw new Error(
            "Household measure learning mutation requires user_learned provenance."
          );
        }

        const lockedMeals = await tx
          .select({ id: meals.id, userId: meals.userId })
          .from(meals)
          .where(and(eq(meals.userId, meal.userId), eq(meals.id, meal.id)))
          .for("update")
          .limit(1);
        if (!lockedMeals.length) return "not_found" as const;
        if (Number(lockedMeals[0].userId) !== meal.userId)
          return "not_found" as const;

        const currentItems = await tx
          .select()
          .from(mealItems)
          .where(eq(mealItems.mealId, meal.id));
        const matchingItems = currentItems.filter((row: unknown) =>
          samePersistedMealItem(row, expectedOriginalItem)
        );
        if (matchingItems.length !== 1) return "stale" as const;
        assertLegacyMealItemMutationSafe(currentItems);

        await replaceMealItemsInTransaction(
          tx,
          { meal, items, resolvedCatalogIds },
          currentItems
            .slice()
            .sort((a: any, b: any) => Number(a.id) - Number(b.id))
        );
        await upsertHouseholdMeasurePreference(tx, {
          userId: meal.userId,
          ...learning,
        });
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
        await tx
          .delete(meals)
          .where(and(eq(meals.userId, userId), eq(meals.id, mealId)));
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

      const rows = await db
        .select()
        .from(mealInferences)
        .where(eq(mealInferences.draftId, draftId))
        .limit(1);
      return rows[0] ?? undefined;
    },

    async findFavoritesByUserId(userId) {
      const db = await deps.getDb();
      if (!db) return [];

      return await db
        .select()
        .from(mealFavorites)
        .where(eq(mealFavorites.userId, userId));
    },

    async upsertFavorite(input) {
      const db = await deps.getDb();
      if (!db) return;

      await db
        .insert(mealFavorites)
        .values(input)
        .onDuplicateKeyUpdate({
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
      return rows.filter(
        (row: { status: string }) => row.status === "confirmed"
      ).length;
    },
  };
}
