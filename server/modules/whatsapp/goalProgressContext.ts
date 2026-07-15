import { AsyncLocalStorage } from "node:async_hooks";

export type WhatsAppGoalProgressContext = {
  exerciseCaloriesByDateKey: Record<string, number>;
};

const whatsappGoalProgressContext = new AsyncLocalStorage<WhatsAppGoalProgressContext>();

export function runWithWhatsAppGoalProgressContext<T>(context: WhatsAppGoalProgressContext, callback: () => T): T {
  return whatsappGoalProgressContext.run(context, callback);
}

export type WhatsAppExerciseForGoalContext = {
  occurredAt: number | string | Date;
  caloriesBurned?: number | null;
  notes?: string | null;
};

const EXTERNAL_REFERENCE_PATTERN = /Referencia externa:\s*([^\s.]+)/i;

/**
 * Soma as calorias de exercícios por date key deduplicando registros que
 * apontam para a mesma atividade externa (por exemplo `strava:<id>`), para
 * que reimportações não inflem a meta efetiva exibida no WhatsApp (#784).
 */
export function buildWhatsAppExerciseCaloriesByDateKey(
  exercises: WhatsAppExerciseForGoalContext[],
  toDateKey: (occurredAt: Date) => string,
): Record<string, number> {
  const totals: Record<string, number> = {};
  const seenExternalReferences = new Set<string>();

  for (const exercise of exercises) {
    const externalReference = exercise.notes?.match(EXTERNAL_REFERENCE_PATTERN)?.[1] ?? null;
    if (externalReference) {
      if (seenExternalReferences.has(externalReference)) continue;
      seenExternalReferences.add(externalReference);
    }
    const occurredAt = new Date(typeof exercise.occurredAt === "string" || typeof exercise.occurredAt === "number"
      ? Number(exercise.occurredAt) || exercise.occurredAt
      : exercise.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) continue;
    const dateKey = toDateKey(occurredAt);
    totals[dateKey] = (totals[dateKey] ?? 0) + Math.max(0, Number(exercise.caloriesBurned ?? 0));
  }

  return totals;
}

export function getWhatsAppExerciseCaloriesForDateKey(dateKey?: string) {
  if (!dateKey) {
    return undefined;
  }

  const context = whatsappGoalProgressContext.getStore();
  return context?.exerciseCaloriesByDateKey[dateKey];
}
