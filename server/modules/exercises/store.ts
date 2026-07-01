import { roundNutritionValue } from "../../../shared/mealTotals";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { canUseMemoryPersistenceFallback } from "../../repositories/memoryFallback";
import type { ExerciseRecord, ExercisesRepository } from "../../repositories/exercisesRepository";

export type ExerciseEntry = ExerciseRecord;

export function sumExercises(items: ExerciseEntry[]) {
  return items.reduce((acc, item) => acc + Number(item.caloriesBurned ?? 0), 0);
}

export function createExercisesService(deps: {
  exercisesRepository: ExercisesRepository;
  buildOccurredAtRange: (date: string) => { startAt: Date; endAt: Date };
  onEvent: (entry: { userId: number; origin: "web"; status: "success"; eventType: string; detail: string }) => void;
}) {
  const exerciseStore = new Map<number, ExerciseEntry[]>();
  let exerciseIdSequence = 1;

  async function getStoredExercises(userId: number) {
    const dbExercises = await deps.exercisesRepository.findByUserId(userId);
    if (dbExercises) {
      if (canUseMemoryPersistenceFallback()) {
        exerciseStore.set(userId, dbExercises);
      }
      return dbExercises;
    }

    return canUseMemoryPersistenceFallback() ? exerciseStore.get(userId) ?? [] : [];
  }

  async function listExercises(userId: number) {
    const exercisesForUser = await getStoredExercises(userId);
    return exercisesForUser.slice().sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt));
  }

  async function listExercisesByDate(userId: number, date: string) {
    const range = deps.buildOccurredAtRange(date);
    const dbExercises = await deps.exercisesRepository.findByUserIdAndRange(userId, range.startAt, range.endAt);
    const exercisesForUser = dbExercises ?? (canUseMemoryPersistenceFallback() ? exerciseStore.get(userId) ?? [] : []);
    return exercisesForUser
      .filter(exercise => getDateKeyInTimeZone(Number(exercise.occurredAt)) === date)
      .slice()
      .sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt));
  }

  async function createExercise(userId: number, input: {
    activityType: string;
    durationMinutes: number;
    caloriesBurned: number;
    occurredAt: string;
    notes?: string;
  }) {
    const created: ExerciseEntry = {
      id: exerciseIdSequence++,
      userId,
      activityType: input.activityType,
      durationMinutes: input.durationMinutes,
      caloriesBurned: input.caloriesBurned,
      notes: input.notes ?? null,
      occurredAt: new Date(input.occurredAt).getTime(),
      createdAt: Date.now(),
      updatedAt: new Date(),
    };

    const current = await listExercises(userId);
    if (canUseMemoryPersistenceFallback()) {
      exerciseStore.set(userId, [created, ...current.filter(item => item.id !== created.id)]);
    }
    await deps.exercisesRepository.insert(created);
    deps.onEvent({
      userId,
      origin: "web",
      status: "success",
      eventType: "exercise.created",
      detail: `Exercício ${created.activityType} registrado com gasto de ${roundNutritionValue(created.caloriesBurned)} kcal.`,
    });
    return created;
  }

  async function updateExercise(userId: number, input: {
    exerciseId: number;
    activityType: string;
    durationMinutes: number;
    caloriesBurned: number;
    occurredAt: string;
    notes?: string;
  }) {
    const current = await listExercises(userId);
    const existing = current.find(item => item.id === input.exerciseId);
    if (!existing) {
      throw new Error("Exercício não encontrado.");
    }

    const updated: ExerciseEntry = {
      ...existing,
      activityType: input.activityType,
      durationMinutes: input.durationMinutes,
      caloriesBurned: input.caloriesBurned,
      occurredAt: new Date(input.occurredAt).getTime(),
      notes: input.notes ?? null,
      updatedAt: new Date(),
    };

    if (canUseMemoryPersistenceFallback()) {
      exerciseStore.set(
        userId,
        current
          .map(item => (item.id === input.exerciseId ? updated : item))
          .sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt)),
      );
    }
    await deps.exercisesRepository.update(updated);
    deps.onEvent({
      userId,
      origin: "web",
      status: "success",
      eventType: "exercise.updated",
      detail: `Exercício ${updated.activityType} atualizado pelo usuário.`,
    });
    return updated;
  }

  async function removeExercise(userId: number, exerciseId: number) {
    const current = await listExercises(userId);
    const existing = current.find(item => item.id === exerciseId);
    if (!existing) {
      throw new Error("Exercício não encontrado.");
    }

    if (canUseMemoryPersistenceFallback()) {
      exerciseStore.set(userId, current.filter(item => item.id !== exerciseId));
    }
    await deps.exercisesRepository.delete(userId, exerciseId);
    deps.onEvent({
      userId,
      origin: "web",
      status: "success",
      eventType: "exercise.deleted",
      detail: `Exercício ${existing.activityType} removido pelo usuário.`,
    });
    return { success: true };
  }

  function clearMemory(userId: number) {
    exerciseStore.delete(userId);
  }

  return {
    listExercises,
    listExercisesByDate,
    createExercise,
    updateExercise,
    removeExercise,
    clearMemory,
  };
}

export type ExercisesService = ReturnType<typeof createExercisesService>;
