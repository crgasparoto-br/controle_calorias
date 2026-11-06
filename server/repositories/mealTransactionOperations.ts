import { and, asc, eq } from "drizzle-orm";
import { mealItems, mealMedia, meals } from "../../drizzle/schema";
import type { MealDraftItem } from "../nutritionEngine";
import { upsertHouseholdMeasurePreference } from "../householdMeasureResolutionPersistence";
import type { SavedMediaRecord } from "./mealsRepository";
import {
  discardUnverifiedCommercialReplacement,
  guardHistoricalMealItemUpdate,
  historyInPlaceEditIndices,
  reconcileHistoricalMealItemSlots,
  retainConfirmedItemRows,
  preserveHistoricalMealValues,
} from "./mealItemHistoryReconciliation";
import { requireFreshReplacementNutrition } from "./mealReplacementNutrition";
import {
  buildMealItemUpdate,
  buildMealItemValues,
  sanitizeUnverifiedReplacement,
  samePersistedMealItem,
} from "./mealItemPersistence";

// Falls back to running directly against `db` when the connection doesn't
// expose `.transaction` (e.g. some memory-backed test doubles); the draft ->
// confirmed status flip below still prevents partial rows from surfacing.
export async function runInTransaction<T>(
  db: any,
  fn: (tx: any) => Promise<T>
): Promise<T> {
  if (typeof db.transaction === "function") {
    return db.transaction(fn);
  }
  return fn(db);
}

export async function assertMealBelongsToUser(
  tx: any,
  userId: number,
  mealId: number
) {
  const rows = await tx
    .select({ id: meals.id })
    .from(meals)
    .where(and(eq(meals.userId, userId), eq(meals.id, mealId)))
    .limit(1);
  return rows.length > 0;
}

export async function lockMealAndItems(tx: any, userId: number, mealId: number) {
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

export async function updateMealMetadataInTransaction(
  tx: any,
  input: {
    userId: number;
    mealId: number;
    mealLabel: string;
    occurredAt: number;
  }
) {
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

export async function replaceMealItemsInTransaction(
  tx: any,
  input: {
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
  },
  previous: Array<typeof mealItems.$inferSelect>
) {
  await tx
    .update(meals)
    .set({ status: "draft" })
    .where(
      and(eq(meals.userId, input.meal.userId), eq(meals.id, input.meal.id))
    );

  const editIndices = historyInPlaceEditIndices(
    previous,
    input.items,
    samePersistedMealItem
  );
  if (editIndices) {
    for (const index of editIndices) {
      const item = input.items[index];
      const saved = previous[index];
      await tx
        .update(mealItems)
        .set({
          ...buildMealItemUpdate(
            item,
            input.resolvedCatalogIds,
            saved.foodSnapshotJson
          ),
          foodCatalogId: saved.foodCatalogId,
        })
        .where(
          and(eq(mealItems.mealId, input.meal.id), eq(mealItems.id, saved.id))
        );
    }
  } else {
    // Only for insertion, removal or identity reorder: reconstruct the list in
    // requested order, carrying metadata solely from a proven matching item.
    const retained = retainConfirmedItemRows(
      previous,
      input.items,
      samePersistedMealItem
    );
    // Only displaced rows can be a predecessor of a reconstructed item.
    // A matched sibling must not invalidate a separately verified direct ID.
    const displaced = previous.filter(row => !retained.includes(row));
    const replaced = reconcileHistoricalMealItemSlots(
      displaced,
      retained,
      input.items,
      input.resolvedCatalogIds
    );
    // Sanitize BEFORE snapshot/classification validation. An old editor may
    // submit stale (or invalid) classification alongside a new catalog ID;
    // neither should contaminate, or prevent, a verified replacement.
    const sanitized = input.items.map((item, index) =>
      replaced[index] ? sanitizeUnverifiedReplacement(item) : item
    );
    const draftValues = preserveHistoricalMealValues(
      buildMealItemValues(input.meal.id, sanitized, input.resolvedCatalogIds),
      sanitized,
      retained
    ).map((value, index) =>
      retained[index]
        ? value
        : discardUnverifiedCommercialReplacement(
            value,
            sanitized[index],
            displaced,
            input.resolvedCatalogIds
          )
    );
    const values = await Promise.all(
      draftValues.map((value, index) =>
        replaced[index]
          ? requireFreshReplacementNutrition(
              tx,
              input.meal.userId,
              displaced,
              input.items[index],
              input.resolvedCatalogIds,
              value
            )
          : value
      )
    );
    await tx.delete(mealItems).where(eq(mealItems.mealId, input.meal.id));
    if (values.length) await tx.insert(mealItems).values(values);
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
    .where(
      and(eq(meals.userId, input.meal.userId), eq(meals.id, input.meal.id))
    );
}

export async function insertConfirmedMealInTransaction(
  tx: any,
  input: {
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
  }
) {
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
  const mealId = Number(
    (mealInsert as any)?.[0]?.insertId ?? (mealInsert as any)?.insertId ?? 0
  );
  if (!mealId) {
    throw new Error("Não foi possível obter o id da refeição criada.");
  }

  if (input.items.length) {
    await tx
      .insert(mealItems)
      .values(
        buildMealItemValues(mealId, input.items, input.resolvedCatalogIds)
      );
  }

  if (input.media.length) {
    await tx.insert(mealMedia).values(
      input.media.map(item => ({
        mealId,
        mediaType: item.mediaType,
        storageKey: item.storageKey,
        storageUrl: item.storageUrl,
        mimeType: item.mimeType,
        originalFileName: item.originalFileName ?? null,
      }))
    );
  }

  await tx
    .update(meals)
    .set({ status: "confirmed" })
    .where(eq(meals.id, mealId));
  return mealId;
}
