import type {
  MealDraftItem,
  MealProcessingResult,
} from "../../nutritionEngine";
import type {
  MealsRepository,
  SavedMediaRecord,
} from "../../repositories/mealsRepository";

type SavedMealLike = {
  id: number;
  userId: number;
  source: "web" | "whatsapp";
  mealLabel: string;
  notes?: string;
  sourceText: string;
  transcript?: string;
  confidence: number;
  occurredAt: number;
  items: MealDraftItem[];
  media: SavedMediaRecord[];
};

type PendingInferenceLike = {
  draftId: string;
  userId: number;
  source: "web" | "whatsapp";
  processed: MealProcessingResult;
  media: SavedMediaRecord[];
};

type MealLoadOptions = {
  startAt?: Date;
  endAt?: Date;
  includeMedia?: boolean;
  adjustmentRead?: boolean;
};

type PersistenceDeps = {
  getDb: () => Promise<any | null>;
  mealsRepository: MealsRepository;
  resolveFoodCatalogIds: (
    items: MealDraftItem[],
    userId: number
  ) => Promise<Map<string, number>>;
  editCatalogCandidates: (items: MealDraftItem[]) => MealDraftItem[];
  parseJsonArray: <T>(value: string | null | undefined, fallback: T[]) => T[];
  logPersistenceWarning: (scope: string, error: unknown) => void;
};

export function createConfirmedMealPersistence(deps: PersistenceDeps) {
  async function persistInferenceToDb(draft: PendingInferenceLike) {
    await deps.mealsRepository.insertInference({
      draftId: draft.draftId,
      userId: draft.userId,
      source: draft.source,
      sourceText: draft.processed.sourceText,
      transcript: draft.processed.transcript,
      media: draft.media,
      reasoning: draft.processed.reasoning,
      confidence: draft.processed.confidence,
      items: draft.processed.items,
      totals: draft.processed.totals,
    });
  }

  async function persistMealToDb(
    meal: SavedMealLike,
    legacyD1Receipt?: { operationKey: string; operationScopeHash: string }
  ): Promise<boolean> {
    const db = await deps.getDb();
    if (!db) {
      if (legacyD1Receipt)
        throw new Error("food-d1-legacy-receipt-db-unavailable");
      return false;
    }
    const receipt = legacyD1Receipt
      ? { ...legacyD1Receipt, replayed: false }
      : undefined;
    const resolvedCatalogIds = meal.items.length
      ? await deps.resolveFoodCatalogIds(meal.items, meal.userId)
      : new Map<string, number>();
    const insertedMealId = await deps.mealsRepository.persistMeal({
      meal: {
        userId: meal.userId,
        source: meal.source,
        mealLabel: meal.mealLabel,
        notes: meal.notes,
        sourceText: meal.sourceText,
        transcript: meal.transcript,
        confidence: meal.confidence,
        occurredAt: meal.occurredAt,
      },
      items: meal.items,
      media: meal.media,
      resolvedCatalogIds,
      legacyD1Receipt: receipt,
    });
    meal.id = insertedMealId || meal.id;
    return receipt?.replayed === true;
  }

  async function updateMealInDb(meal: SavedMealLike, expectedPreImage?: string) {
    const db = await deps.getDb();
    if (!db) {
      if (expectedPreImage)
        throw new Error("Meal batch mutation requires persisted compare-and-swap.");
      return { persisted: false as const };
    }
    const resolvedCatalogIds = meal.items.length
      ? await deps.resolveFoodCatalogIds(
          deps.editCatalogCandidates(meal.items),
          meal.userId
        )
      : new Map<string, number>();
    const mutationPreImage = await deps.mealsRepository.persistMealUpdate({
      meal: {
        id: meal.id,
        userId: meal.userId,
        mealLabel: meal.mealLabel,
        notes: meal.notes,
        confidence: meal.confidence,
        occurredAt: meal.occurredAt,
      },
      items: meal.items,
      resolvedCatalogIds,
      expectedPreImage,
    });
    if (expectedPreImage && typeof mutationPreImage !== "string") {
      throw new Error("Meal persistence did not return a post-image CAS token.");
    }
    return { persisted: true as const, mutationPreImage };
  }

  async function deleteMealFromDb(userId: number, mealId: number) {
    const db = await deps.getDb();
    if (!db) return;
    await deps.mealsRepository.deleteMeal(userId, mealId);
  }

  async function loadMealsFromDb(
    userId: number,
    options: MealLoadOptions = {}
  ) {
    const dbMeals = await deps.mealsRepository.findConfirmedByUserId(
      userId,
      options
    );
    return dbMeals;
  }

  async function loadPendingMealDraftFromDb(draftId: string) {
    const db = await deps.getDb();
    if (!db) return undefined;
    try {
      const row = await deps.mealsRepository.findInferenceByDraftId(draftId);
      if (!row) return undefined;
      const requestText = row.sourceText ?? row.requestSummary ?? "";
      const items = deps.parseJsonArray<MealDraftItem>(row.itemsJson, []);
      const rawTotals = row.totalsJson
        ? (JSON.parse(row.totalsJson) as Record<string, number>)
        : {};
      const mealLabel =
        requestText.split(/[,.!?\n]/)[0]?.trim() ||
        items[0]?.foodName ||
        "Refeição";
      return {
        draftId: row.draftId,
        userId: row.userId,
        source: row.source,
        processed: {
          sourceText: requestText,
          transcript: row.transcript ?? undefined,
          reasoning: row.reasoning ?? "",
          confidence: row.confidence,
          detectedMealLabel: mealLabel,
          needsConfirmation: true,
          items,
          totals: {
            calories: Number(rawTotals.calories ?? 0),
            protein: Number(rawTotals.protein ?? 0),
            carbs: Number(rawTotals.carbs ?? 0),
            fat: Number(rawTotals.fat ?? 0),
          },
        },
        media: deps.parseJsonArray<SavedMediaRecord>(row.mediaJson, []),
        createdAt: new Date(row.createdAt).getTime(),
      };
    } catch (error) {
      deps.logPersistenceWarning("Pending inference rehydration skipped", error);
      return undefined;
    }
  }

  return {
    persistInferenceToDb,
    persistMealToDb,
    updateMealInDb,
    deleteMealFromDb,
    loadMealsFromDb,
    loadPendingMealDraftFromDb,
  };
}
