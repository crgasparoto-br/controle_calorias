import { and, eq } from "drizzle-orm";
import { mealFavorites } from "../../../drizzle/schema";
import { calculateMealTotals } from "../../../shared/mealTotals";
import { getDb, logInferenceEvent } from "../../db";
import type {
  CopyMealGroupInput,
  RemoveMealGroupInput,
  SaveFavoriteMealGroupInput,
  UpdateMealGroupInput,
} from "./schemas";
import { createManualMeal, listMeals, removeMeal, updateMeal } from "./service";

type MealForGroupOperation = Awaited<ReturnType<typeof listMeals>>[number];

function uniqueMealIds(mealIds: number[]) {
  return Array.from(new Set(mealIds));
}

async function getValidatedMealGroup(userId: number, mealIds: number[]) {
  const targetIds = uniqueMealIds(mealIds);
  const meals = await listMeals(userId);
  const selectedMeals = targetIds
    .map(mealId => meals.find(meal => meal.id === mealId))
    .filter(Boolean) as MealForGroupOperation[];

  if (selectedMeals.length !== targetIds.length) {
    throw new Error("Uma ou mais refeições do grupo não foram encontradas.");
  }

  return selectedMeals;
}

function buildGroupNotes(meals: MealForGroupOperation[]) {
  const notes = meals
    .map(meal => meal.notes?.trim())
    .filter((note): note is string => Boolean(note));

  return notes.length ? Array.from(new Set(notes)).join("\n\n") : undefined;
}

function buildGroupItems(meals: MealForGroupOperation[]) {
  return meals.flatMap(meal => meal.items.map(item => ({ ...item })));
}

export async function updateMealGroup(userId: number, input: UpdateMealGroupInput) {
  const targetIds = input.meals.map(meal => meal.mealId);
  const selectedMeals = await getValidatedMealGroup(userId, targetIds);
  const selectedById = new Map(selectedMeals.map(meal => [meal.id, meal]));
  const totalItems = input.meals.reduce((count, meal) => count + meal.items.length, 0);

  if (totalItems <= 0) {
    throw new Error("O grupo precisa manter ao menos um alimento.");
  }

  const updatedMeals = [];
  const removedMealIds = [];

  for (const mealInput of input.meals) {
    const existing = selectedById.get(mealInput.mealId);
    if (!existing) {
      throw new Error("Refeição não encontrada no grupo selecionado.");
    }

    if (!mealInput.items.length) {
      await removeMeal(userId, mealInput.mealId);
      removedMealIds.push(mealInput.mealId);
      continue;
    }

    updatedMeals.push(await updateMeal(userId, {
      mealId: mealInput.mealId,
      mealLabel: input.mealLabel,
      occurredAt: new Date(existing.occurredAt).toISOString(),
      notes: existing.notes,
      items: mealInput.items,
    }));
  }

  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "meal.group_updated",
    detail: `${updatedMeals.length} refeição(ões) atualizada(s) e ${removedMealIds.length} removida(s) no grupo ${input.mealLabel}.`,
  });

  return {
    updatedMeals,
    removedMealIds,
  };
}

export async function copyMealGroup(userId: number, input: CopyMealGroupInput) {
  const selectedMeals = await getValidatedMealGroup(userId, input.mealIds);
  const items = buildGroupItems(selectedMeals);

  if (!items.length) {
    throw new Error("O grupo selecionado não possui alimentos para copiar.");
  }

  return createManualMeal(userId, {
    mealLabel: input.mealLabel?.trim() || selectedMeals[0]?.mealLabel || "Refeição",
    occurredAt: input.occurredAt,
    notes: buildGroupNotes(selectedMeals),
    items,
  });
}

export async function removeMealGroup(userId: number, input: RemoveMealGroupInput) {
  const selectedMeals = await getValidatedMealGroup(userId, input.mealIds);

  for (const meal of selectedMeals) {
    await removeMeal(userId, meal.id);
  }

  return {
    success: true,
    removedMealIds: selectedMeals.map(meal => meal.id),
  };
}

export async function saveMealGroupFavorite(userId: number, input: SaveFavoriteMealGroupInput) {
  const selectedMeals = await getValidatedMealGroup(userId, input.mealIds);
  const items = buildGroupItems(selectedMeals);

  if (!items.length) {
    throw new Error("O grupo selecionado não possui alimentos para favoritar.");
  }

  const favorite = {
    id: 0,
    userId,
    name: input.name?.trim() || selectedMeals[0]?.mealLabel || "Refeição favorita",
    mealLabel: selectedMeals[0]?.mealLabel || "Refeição",
    notes: buildGroupNotes(selectedMeals),
    items,
    createdAt: Date.now(),
  };

  const db = await getDb();
  if (db) {
    await db.insert(mealFavorites).values({
      userId,
      name: favorite.name,
      mealLabel: favorite.mealLabel,
      notes: favorite.notes ?? null,
      itemsJson: JSON.stringify(favorite.items),
    }).onDuplicateKeyUpdate({
      set: {
        mealLabel: favorite.mealLabel,
        notes: favorite.notes ?? null,
        itemsJson: JSON.stringify(favorite.items),
      },
    });

    const rows = await db
      .select()
      .from(mealFavorites)
      .where(and(eq(mealFavorites.userId, userId), eq(mealFavorites.name, favorite.name)))
      .limit(1);

    const saved = rows[0];
    if (saved) {
      favorite.id = saved.id;
      favorite.createdAt = new Date(saved.createdAt).getTime();
    }
  }

  logInferenceEvent({
    userId,
    origin: "web",
    status: "success",
    eventType: "meal.group_favorite_saved",
    detail: `Grupo favorito ${favorite.name} salvo com ${favorite.items.length} itens.`,
  });

  return {
    ...favorite,
    totals: calculateMealTotals(favorite.items),
  };
}
