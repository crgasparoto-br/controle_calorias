import type { MealItemInput } from "../meals/schemas";
import { assertLegacyMealProjectionSafe } from "../meals/foodV2Snapshot";
import { updateMeal, type UpdateMealServiceOptions } from "../meals/service";
import { MEAL_UPDATE_SERVICE_OPTIONS } from "../meals/mealUpdateOptions";
import { getMealMutationPreImage } from "../meals/mealMutationToken";
import { isSha256MutationToken } from "../persistenceTokens";

export type MealBatchMutationSnapshot = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string | null;
  items: MealItemInput[];
  /** Exact raw persisted row fingerprint from the internal adjustment read. */
  mutationPreImage?: string;
};

export type MealBatchMutationChange = {
  before: MealBatchMutationSnapshot;
  after: MealBatchMutationSnapshot;
};

export class MealBatchMutationError extends Error {
  readonly rollbackSucceeded: boolean;
  readonly originalError: unknown;
  readonly rollbackErrors: unknown[];

  constructor(originalError: unknown, rollbackErrors: unknown[]) {
    super(
      rollbackErrors.length
        ? "Falha ao atualizar todas as refeições e ao restaurar pelo menos uma alteração parcial."
        : "Falha ao atualizar todas as refeições; as alterações parciais foram restauradas."
    );
    this.name = "MealBatchMutationError";
    this.rollbackSucceeded = rollbackErrors.length === 0;
    this.originalError = originalError;
    this.rollbackErrors = rollbackErrors;
  }
}

function toUpdateInput(
  meal: MealBatchMutationSnapshot,
  options?: UpdateMealServiceOptions
) {
  return Object.assign(
    {
      mealId: meal.id,
      mealLabel: meal.mealLabel,
      occurredAt: new Date(meal.occurredAt).toISOString(),
      notes: meal.notes ?? undefined,
      items: meal.items,
    },
    options ? { [MEAL_UPDATE_SERVICE_OPTIONS]: options } : {}
  );
}

function compensableUpdateOptions(
  expectedPreImage: string,
  finalizeBatch?: UpdateMealServiceOptions["finalizeBatch"]
): UpdateMealServiceOptions {
  return {
    recordCatalogUsage: false,
    updateHabits: false,
    logEvent: false,
    expectedPreImage,
    finalizeBatch,
  };
}

function validateChanges(changes: MealBatchMutationChange[]) {
  const mealIds = new Set<number>();
  for (const change of changes) {
    if (change.before.id !== change.after.id) {
      throw new Error(
        "A atualização em lote não pode trocar a identidade da refeição."
      );
    }
    if (mealIds.has(change.after.id)) {
      throw new Error(
        `A refeição ${change.after.id} apareceu mais de uma vez na atualização em lote.`
      );
    }
    if (!isSha256MutationToken(change.before.mutationPreImage)) {
      throw new Error(
        "A atualização em lote exige um pre-image persistido e verificável."
      );
    }
    // Validate the entire batch before touching the first V1 meal. A later
    // physically bound V2 sibling cannot be faithfully rolled back by the V1
    // compensation writer, so even a no-op V2 snapshot aborts the whole batch.
    assertLegacyMealProjectionSafe(change.before.items);
    assertLegacyMealProjectionSafe(change.after.items);
    mealIds.add(change.after.id);
  }
}

/**
 * Applies a multi-meal request with per-meal compare-and-swap. A failed later
 * write is compensated only if each committed meal still matches the exact
 * post-image returned by its transaction; concurrent edits are never overwritten.
 */
export async function updateMealsWithCompensation(
  userId: number,
  changes: MealBatchMutationChange[]
) {
  validateChanges(changes);
  if (!changes.length) return [];

  const committed: Array<{
    change: MealBatchMutationChange;
    postImage: string;
  }> = [];
  const updatedMeals: Awaited<ReturnType<typeof updateMeal>>[] = [];
  let inFlight: MealBatchMutationChange | null = null;

  try {
    for (const [index, change] of changes.entries()) {
      inFlight = change;
      const finalizeBatch =
        index === changes.length - 1
          ? { meals: changes.map(item => ({ items: item.after.items })) }
          : undefined;
      const updatedMeal = await updateMeal(
        userId,
        toUpdateInput(
          change.after,
          compensableUpdateOptions(
            change.before.mutationPreImage!,
            finalizeBatch
          )
        )
      );
      const postImage = getMealMutationPreImage(updatedMeal);
      if (!isSha256MutationToken(postImage)) {
        throw new Error(
          "A atualização não retornou confirmação do post-image persistido."
        );
      }
      committed.push({ change, postImage });
      updatedMeals.push(updatedMeal);
      inFlight = null;
    }
    return updatedMeals;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    if (inFlight) {
      // The call may have committed before its acknowledgement was lost. Do
      // not guess its post-image or blindly write the old meal back over it.
      rollbackErrors.push(
        new Error(
          "Mutation outcome unverified; post-image CAS token unavailable."
        )
      );
    }

    for (const [index, entry] of [...committed].reverse().entries()) {
      try {
        const finalizeBatch =
          index === committed.length - 1
            ? {
                meals: committed.map(item => ({
                  items: item.change.before.items,
                })),
                recordCatalogUsage: false,
                throwOnHabitFailure: true,
              }
            : undefined;
        await updateMeal(
          userId,
          toUpdateInput(
            entry.change.before,
            compensableUpdateOptions(entry.postImage, finalizeBatch)
          )
        );
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    throw new MealBatchMutationError(error, rollbackErrors);
  }
}

export function describeMealBatchMutationFailure(error: unknown) {
  const rollbackSucceeded =
    error instanceof MealBatchMutationError && error.rollbackSucceeded;
  return {
    rollbackSucceeded,
    userMessage: rollbackSucceeded
      ? "Não consegui concluir todas as alterações. As refeições foram restauradas e nenhuma mudança parcial foi mantida. Envie o pedido novamente."
      : "Não consegui concluir todas as alterações com segurança. Consulte suas refeições atuais antes de tentar novamente.",
    detail: rollbackSucceeded
      ? "Atualização multirrefeição falhou e a compensação restaurou todas as refeições tentadas."
      : "Atualização multirrefeição falhou sem confirmação de restauração completa; o estado atual deve ser consultado.",
  };
}
