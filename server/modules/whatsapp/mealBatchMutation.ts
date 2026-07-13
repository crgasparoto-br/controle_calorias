import type { MealItemInput } from "../meals/schemas";
import { updateMeal } from "../meals/service";

export type MealBatchMutationSnapshot = {
  id: number;
  mealLabel: string;
  occurredAt: number | string | Date;
  notes?: string | null;
  items: MealItemInput[];
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
    super(rollbackErrors.length
      ? "Falha ao atualizar todas as refeições e ao restaurar pelo menos uma alteração parcial."
      : "Falha ao atualizar todas as refeições; as alterações parciais foram restauradas.");
    this.name = "MealBatchMutationError";
    this.rollbackSucceeded = rollbackErrors.length === 0;
    this.originalError = originalError;
    this.rollbackErrors = rollbackErrors;
  }
}

function toUpdateInput(meal: MealBatchMutationSnapshot) {
  return {
    mealId: meal.id,
    mealLabel: meal.mealLabel,
    occurredAt: new Date(meal.occurredAt).toISOString(),
    notes: meal.notes ?? undefined,
    items: meal.items,
  };
}

function validateChanges(changes: MealBatchMutationChange[]) {
  const mealIds = new Set<number>();
  for (const change of changes) {
    if (change.before.id !== change.after.id) {
      throw new Error("A atualização em lote não pode trocar a identidade da refeição.");
    }
    if (mealIds.has(change.after.id)) {
      throw new Error(`A refeição ${change.after.id} apareceu mais de uma vez na atualização em lote.`);
    }
    mealIds.add(change.after.id);
  }
}

/**
 * Aplica uma solicitação multirrefeição como uma unidade lógica.
 *
 * `updateMeal` mantém o pipeline canônico de catálogo, snapshots e hábitos. Como
 * esse pipeline ainda não expõe uma transação única entre refeições, qualquer
 * erro dispara compensação em ordem inversa, inclusive para a chamada que
 * lançou o erro (ela pode ter persistido a refeição antes de falhar em um efeito
 * complementar). O chamador só deve responder sucesso depois deste método.
 */
export async function updateMealsWithCompensation(
  userId: number,
  changes: MealBatchMutationChange[],
) {
  validateChanges(changes);
  if (!changes.length) return [];

  const attempted: MealBatchMutationChange[] = [];
  const updatedMeals: Awaited<ReturnType<typeof updateMeal>>[] = [];

  try {
    for (const change of changes) {
      attempted.push(change);
      updatedMeals.push(await updateMeal(userId, toUpdateInput(change.after)));
    }
    return updatedMeals;
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    for (const change of [...attempted].reverse()) {
      try {
        await updateMeal(userId, toUpdateInput(change.before));
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    throw new MealBatchMutationError(error, rollbackErrors);
  }
}

export function describeMealBatchMutationFailure(error: unknown) {
  const rollbackSucceeded = error instanceof MealBatchMutationError && error.rollbackSucceeded;
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
