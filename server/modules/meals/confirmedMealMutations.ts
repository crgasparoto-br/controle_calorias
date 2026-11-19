import type { MealDraftItem } from "../../nutritionEngine";

type MealRecord = {
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
  media: any[];
  createdAt: number;
  mutationPreImage?: string;
};

type PendingInference = {
  draftId: string;
  userId: number;
  source: "web" | "whatsapp";
  processed: {
    sourceText: string;
    transcript?: string;
    reasoning: string;
    confidence: number;
    detectedMealLabel: string;
    needsConfirmation: boolean;
    items: MealDraftItem[];
    totals: { calories: number; protein: number; carbs: number; fat: number };
  };
  media: any[];
  createdAt: number;
};

type FavoriteMeal = {
  id: number;
  userId: number;
  name: string;
  mealLabel: string;
  notes?: string;
  items: MealDraftItem[];
  createdAt: number;
};

type MealTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type MutationDeps = {
  mealStore: Map<number, MealRecord[]>;
  inferenceStore: Map<string, PendingInference>;
  favoriteMealStore: Map<number, FavoriteMeal[]>;
  nextMealId: () => number;
  nextFavoriteMealId: () => number;
  loadMealsFromDb: (userId: number, options?: any) => Promise<MealRecord[] | null>;
  persistMealToDb: (
    meal: MealRecord,
    legacyD1Receipt?: { operationKey: string; operationScopeHash: string }
  ) => Promise<boolean>;
  updateMealInDb: (meal: MealRecord) => Promise<any>;
  deleteMealFromDb: (userId: number, mealId: number) => Promise<void>;
  updateHabitsFromMeal: (meal: MealRecord) => Promise<void>;
  rebuildUserMealHabits: (userId: number) => Promise<unknown>;
  assertLegacyMealProjectionSafe: (items: MealDraftItem[]) => void;
  syncHabitsMealLabelFromMeals: (
    userId: number,
    meals: MealRecord[]
  ) => Promise<void>;
  clearMealItemsSourceMedia: (items: MealDraftItem[]) => MealDraftItem[];
  getDb: () => Promise<any | null>;
  mealsRepository: {
    findFavoritesByUserId: (userId: number) => Promise<any[]>;
    upsertFavorite: (input: any) => Promise<void>;
  };
  parseJsonArray: <T>(value: string | null | undefined, fallback: T[]) => T[];
  sumMealItems: (items: MealDraftItem[]) => MealTotals;
  calculateDayTotals: (meals: Array<{ items: MealDraftItem[] }>) => MealTotals;
  buildOccurredAtRange: (date: string, timeZone?: string) => {
    startAt: Date;
    endAt: Date;
  };
  getDateKeyInTimeZone: (value: number, timeZone: string) => string;
  getUtcRangeForInclusiveLocalDateRange: (
    startDate: string,
    endDate: string,
    timeZone: string
  ) => { startAt: Date; endAt: Date };
  defaultTimeZone: string;
  logPersistenceWarning: (scope: string, error: unknown) => void;
  logInferenceEvent: (entry: any) => void;
};

export function createConfirmedMealMutations(deps: MutationDeps) {
  async function confirmPendingMeal(input: {
    draftId: string;
    userId: number;
    mealLabel: string;
    occurredAt: string;
    notes?: string;
    items: MealDraftItem[];
  }) {
    const pending = deps.inferenceStore.get(input.draftId);
    if (!pending || pending.userId !== input.userId) {
      throw new Error("Rascunho de inferência não encontrado.");
    }
    const savedMeal: MealRecord = {
      id: deps.nextMealId(),
      userId: input.userId,
      source: pending.source,
      mealLabel: input.mealLabel,
      status: "confirmed",
      occurredAt: new Date(input.occurredAt).getTime(),
      notes: input.notes,
      sourceText: pending.processed.sourceText,
      transcript: pending.processed.transcript,
      confidence: pending.processed.confidence,
      items: input.items,
      media: pending.media,
      createdAt: Date.now(),
    };
    const mealsForUser =
      (await deps.loadMealsFromDb(input.userId)) ??
      deps.mealStore.get(input.userId) ??
      [];
    await deps.persistMealToDb(savedMeal);
    deps.mealStore.set(input.userId, [
      savedMeal,
      ...mealsForUser.filter(meal => meal.id !== savedMeal.id),
    ]);
    deps.inferenceStore.delete(input.draftId);
    await deps.updateHabitsFromMeal(savedMeal);

    try {
      const { recordNutritionLabelCandidates } = await import(
        "../../nutritionLabelCandidateService"
      );
      await recordNutritionLabelCandidates({
        userId: savedMeal.userId,
        mealId: savedMeal.id,
        sourceText: savedMeal.sourceText,
        items: savedMeal.items,
      });
    } catch (error) {
      deps.logPersistenceWarning(
        "Nutrition label candidate persistence skipped",
        error
      );
    }
    if (savedMeal.sourceText && savedMeal.source === "whatsapp") {
      const { learnPersonalFoodAlias } = await import(
        "../whatsapp/personalFoodAliasStore"
      );
      for (const item of savedMeal.items) {
        learnPersonalFoodAlias({
          userId: savedMeal.userId,
          aliasText: savedMeal.sourceText,
          canonicalName: item.canonicalName,
          canonicalSlug:
            item.source === "catalog" ? item.canonicalName : undefined,
        });
      }
    }
    deps.logInferenceEvent({
      userId: input.userId,
      origin: pending.source,
      status: "success",
      eventType: "meal.confirmed",
      detail: `Refeição ${savedMeal.mealLabel} confirmada e salva com ${savedMeal.items.length} itens.`,
    });
    return savedMeal;
  }

  async function listUserMeals(
    userId: number,
    options: { adjustmentRead?: boolean } = {}
  ) {
    const dbMeals = await deps.loadMealsFromDb(userId, options);
    const mealsForUser = dbMeals ?? deps.mealStore.get(userId) ?? [];
    if (dbMeals && !options.adjustmentRead) {
      deps.mealStore.set(userId, dbMeals);
    }
    return mealsForUser
      .slice()
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .map(meal => ({ ...meal, totals: deps.sumMealItems(meal.items) }));
  }

  async function listUserMealsByDate(
    userId: number,
    date: string,
    options: { includeMedia?: boolean; timeZone?: string } = {}
  ) {
    const timeZone = options.timeZone ?? deps.defaultTimeZone;
    const range = deps.buildOccurredAtRange(date, timeZone);
    const dbMeals = await deps.loadMealsFromDb(userId, {
      ...range,
      includeMedia: options.includeMedia,
    });
    const mealsForUser = dbMeals ?? deps.mealStore.get(userId) ?? [];
    return mealsForUser
      .filter(meal => deps.getDateKeyInTimeZone(meal.occurredAt, timeZone) === date)
      .slice()
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .map(meal => ({ ...meal, totals: deps.sumMealItems(meal.items) }));
  }

  async function listUserMealsInRange(
    userId: number,
    startDate: string,
    endDate: string,
    options: { includeMedia?: boolean; timeZone?: string } = {}
  ) {
    const timeZone = options.timeZone ?? deps.defaultTimeZone;
    const { startAt, endAt } = deps.getUtcRangeForInclusiveLocalDateRange(
      startDate,
      endDate,
      timeZone
    );
    const dbMeals = await deps.loadMealsFromDb(userId, {
      startAt,
      endAt,
      includeMedia: options.includeMedia,
    });
    const mealsForUser = dbMeals ?? deps.mealStore.get(userId) ?? [];
    return mealsForUser
      .filter(meal => {
        const key = deps.getDateKeyInTimeZone(meal.occurredAt, timeZone);
        return key >= startDate && key <= endDate;
      })
      .slice()
      .sort((a, b) => b.occurredAt - a.occurredAt)
      .map(meal => ({ ...meal, totals: deps.sumMealItems(meal.items) }));
  }

  async function getUserDayMealTotals(
    userId: number,
    date: string,
    timeZone = deps.defaultTimeZone
  ) {
    const key = date || deps.getDateKeyInTimeZone(Date.now(), timeZone);
    const mealsOnDay = await listUserMealsByDate(userId, key, { timeZone });
    return { date: key, meals: mealsOnDay, totals: deps.calculateDayTotals(mealsOnDay) };
  }

  async function createUserManualMeal(input: {
    userId: number;
    mealLabel: string;
    occurredAt: string;
    notes?: string;
    items: MealDraftItem[];
    legacyD1Receipt?: { operationKey: string; operationScopeHash: string };
  }) {
    deps.assertLegacyMealProjectionSafe(input.items);
    const savedMeal: MealRecord = {
      id: deps.nextMealId(),
      userId: input.userId,
      source: "web",
      mealLabel: input.mealLabel,
      status: "confirmed",
      occurredAt: new Date(input.occurredAt).getTime(),
      notes: input.notes,
      sourceText: input.notes ?? "Registro manual",
      confidence: 1,
      items: input.items,
      media: [],
      createdAt: Date.now(),
    };
    const current = await listUserMeals(input.userId);
    const replayed = await deps.persistMealToDb(
      savedMeal,
      input.legacyD1Receipt
    );
    if (replayed) {
      const committed = (await deps.loadMealsFromDb(input.userId))?.find(
        meal => meal.id === savedMeal.id
      );
      if (!committed) {
        throw new Error("food-d1-legacy-receipt-meal-unavailable");
      }
      await deps.rebuildUserMealHabits(input.userId);
      return { ...committed, totals: deps.sumMealItems(committed.items) };
    }
    deps.mealStore.set(input.userId, [
      savedMeal,
      ...current.filter(meal => meal.id !== savedMeal.id),
    ]);
    await deps.updateHabitsFromMeal(savedMeal);
    deps.logInferenceEvent({
      userId: input.userId,
      origin: "web",
      status: "success",
      eventType: "meal.manual_created",
      detail: `Refeição manual ${savedMeal.mealLabel} criada com ${savedMeal.items.length} itens.`,
    });
    return { ...savedMeal, totals: deps.sumMealItems(savedMeal.items) };
  }

  async function copyUserMeal(input: {
    userId: number;
    mealId: number;
    occurredAt: string;
    mealLabel?: string;
  }) {
    const current = await listUserMeals(input.userId);
    const sourceMeal = current.find(meal => meal.id === input.mealId);
    if (!sourceMeal) throw new Error("Refeição de origem não encontrada.");
    return createUserManualMeal({
      userId: input.userId,
      mealLabel: input.mealLabel?.trim() || sourceMeal.mealLabel,
      occurredAt: input.occurredAt,
      notes: sourceMeal.notes,
      items: deps.clearMealItemsSourceMedia(sourceMeal.items),
    });
  }

  async function listFavoriteMeals(userId: number) {
    const db = await deps.getDb();
    if (db) {
      try {
        const rows = await deps.mealsRepository.findFavoritesByUserId(userId);
        const favorites = rows.map(row => ({
          id: row.id,
          userId: row.userId,
          name: row.name,
          mealLabel: row.mealLabel,
          notes: row.notes ?? undefined,
          items: deps.parseJsonArray<MealDraftItem>(row.itemsJson, []),
          createdAt: new Date(row.createdAt).getTime(),
        }));
        deps.favoriteMealStore.set(userId, favorites);
        return favorites
          .sort((a, b) => b.createdAt - a.createdAt)
          .map(meal => ({ ...meal, totals: deps.sumMealItems(meal.items) }));
      } catch (error) {
        deps.logPersistenceWarning("Meal favorites read skipped", error);
      }
    }
    return (deps.favoriteMealStore.get(userId) ?? [])
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(meal => ({ ...meal, totals: deps.sumMealItems(meal.items) }));
  }

  async function saveFavoriteMeal(input: {
    userId: number;
    mealId: number;
    name?: string;
  }) {
    const current = await listUserMeals(input.userId);
    const meal = current.find(item => item.id === input.mealId);
    if (!meal) {
      throw new Error("Refeição não encontrada para favoritar.");
    }
    deps.assertLegacyMealProjectionSafe(meal.items);
    const favorite: FavoriteMeal = {
      id: deps.nextFavoriteMealId(),
      userId: input.userId,
      name: input.name?.trim() || meal.mealLabel,
      mealLabel: meal.mealLabel,
      notes: meal.notes,
      items: deps.clearMealItemsSourceMedia(meal.items),
      createdAt: Date.now(),
    };
    const favorites = deps.favoriteMealStore.get(input.userId) ?? [];
    deps.favoriteMealStore.set(input.userId, [
      favorite,
      ...favorites.filter(item => item.name !== favorite.name),
    ]);
    const db = await deps.getDb();
    if (db) {
      try {
        await deps.mealsRepository.upsertFavorite({
          userId: input.userId,
          name: favorite.name,
          mealLabel: favorite.mealLabel,
          notes: favorite.notes,
          itemsJson: JSON.stringify(favorite.items),
        });
      } catch (error) {
        deps.logPersistenceWarning("Meal favorite persistence skipped", error);
      }
    }
    deps.logInferenceEvent({
      userId: input.userId,
      origin: "web",
      status: "success",
      eventType: "meal.favorite_saved",
      detail: `Refeição favorita ${favorite.name} salva com ${favorite.items.length} itens.`,
    });
    return { ...favorite, totals: deps.sumMealItems(favorite.items) };
  }

  async function relabelUserMeals(input: {
    userId: number;
    mealIds: number[];
    mealLabel: string;
    origin?: "web" | "whatsapp";
  }) {
    const origin = input.origin ?? "web";
    const current = await listUserMeals(input.userId);
    const targetIds = new Set(input.mealIds);
    const existingMeals = current.filter(meal => targetIds.has(meal.id));
    if (!existingMeals.length) {
      throw new Error("Nenhuma refeição encontrada para reclassificação.");
    }
    const updatedMeals = existingMeals.map(meal => ({
      ...meal,
      mealLabel: input.mealLabel,
    }));
    deps.mealStore.set(
      input.userId,
      current
        .map(meal => updatedMeals.find(updated => updated.id === meal.id) ?? meal)
        .sort((a, b) => b.occurredAt - a.occurredAt)
    );
    for (const meal of updatedMeals) await deps.updateMealInDb(meal);
    await deps.syncHabitsMealLabelFromMeals(input.userId, updatedMeals);
    deps.logInferenceEvent({
      userId: input.userId,
      origin,
      status: "success",
      eventType: "meal.reclassified",
      detail: `${updatedMeals.length} refeição(ões) reclassificada(s) para ${input.mealLabel}.`,
    });
    return updatedMeals.map(meal => ({
      ...meal,
      totals: deps.sumMealItems(meal.items),
    }));
  }

  return {
    confirmPendingMeal,
    listUserMeals,
    listUserMealsByDate,
    listUserMealsInRange,
    getUserDayMealTotals,
    createUserManualMeal,
    copyUserMeal,
    listFavoriteMeals,
    saveFavoriteMeal,
    relabelUserMeals,
  };
}
