import { roundNutritionValue } from "../../../shared/mealTotals";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { canUseMemoryPersistenceFallback } from "../../repositories/memoryFallback";
import type { ExerciseRecord, ExercisesRepository, ExternalExerciseImportStatus } from "../../repositories/exercisesRepository";

export type ExerciseEntry = ExerciseRecord;

export function sumExercises(items: ExerciseEntry[]) {
  return items.reduce((acc, item) => acc + Number(item.caloriesBurned ?? 0), 0);
}

function normalizeExternalId(value: string | number | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function getExternalExerciseReference(exercise: Pick<ExerciseEntry, "notes" | "externalProvider" | "externalId">) {
  const structuredProvider = exercise.externalProvider?.trim().toLowerCase();
  const structuredId = normalizeExternalId(exercise.externalId);
  if (structuredProvider && structuredId) return `${structuredProvider}:${structuredId}`;

  const reference = /\bstrava:([a-zA-Z0-9_-]+)\b/i.exec(exercise.notes ?? "")?.[1];
  return reference ? `strava:${reference.toLowerCase()}` : null;
}

function withExternalImportStatus(exercise: ExerciseEntry, status: ExternalExerciseImportStatus): ExerciseEntry {
  return { ...exercise, externalImportStatus: status };
}

export function createExercisesService(deps: {
  exercisesRepository: ExercisesRepository;
  buildOccurredAtRange: (date: string, timeZone: string) => { startAt: Date; endAt: Date };
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

  async function listExercisesByDate(userId: number, date: string, timeZone = DEFAULT_APP_TIME_ZONE) {
    const range = deps.buildOccurredAtRange(date, timeZone);
    const dbExercises = await deps.exercisesRepository.findByUserIdAndRange(userId, range.startAt, range.endAt);
    const exercisesForUser = dbExercises ?? (canUseMemoryPersistenceFallback() ? exerciseStore.get(userId) ?? [] : []);
    return exercisesForUser
      .filter(exercise => getDateKeyInTimeZone(Number(exercise.occurredAt), timeZone) === date)
      .slice()
      .sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt));
  }

  async function listExercisesInRange(userId: number, startAt: Date, endAt: Date) {
    const dbExercises = await deps.exercisesRepository.findByUserIdAndRange(userId, startAt, endAt);
    const exercisesForUser = dbExercises ?? (canUseMemoryPersistenceFallback() ? exerciseStore.get(userId) ?? [] : []);
    return exercisesForUser
      .filter(exercise => Number(exercise.occurredAt) >= startAt.getTime() && Number(exercise.occurredAt) < endAt.getTime())
      .slice()
      .sort((a, b) => Number(b.occurredAt) - Number(a.occurredAt));
  }

  async function createExercise(userId: number, input: {
    activityType: string;
    durationMinutes: number;
    caloriesBurned: number;
    occurredAt: string;
    notes?: string;
    externalProvider?: string;
    externalId?: string;
  }) {
    const current = await listExercises(userId);
    const externalReference = getExternalExerciseReference({
      notes: input.notes,
      externalProvider: input.externalProvider,
      externalId: input.externalId,
    });
    const existingExternal = externalReference
      ? current.find(item => getExternalExerciseReference(item) === externalReference)
      : null;

    if (existingExternal) {
      const updated = withExternalImportStatus({
        ...existingExternal,
        activityType: input.activityType,
        durationMinutes: input.durationMinutes,
        caloriesBurned: input.caloriesBurned,
        notes: input.notes ?? null,
        occurredAt: new Date(input.occurredAt).getTime(),
        externalProvider: input.externalProvider?.trim().toLowerCase() || existingExternal.externalProvider || null,
        externalId: normalizeExternalId(input.externalId) || existingExternal.externalId || null,
        updatedAt: new Date(),
      }, "updated");

      if (canUseMemoryPersistenceFallback()) {
        exerciseStore.set(
          userId,
          current
            .map(item => (item.id === updated.id ? updated : item))
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
      externalProvider: input.externalProvider?.trim().toLowerCase() || null,
      externalId: normalizeExternalId(input.externalId),
      externalImportStatus: externalReference ? "created" : undefined,
    };

    await deps.exercisesRepository.insert(created);
    const finalStatus = created.externalImportStatus ?? (externalReference ? "created" : undefined);
    if (canUseMemoryPersistenceFallback()) {
      exerciseStore.set(userId, [created, ...current.filter(item => item.id !== created.id)]);
    }

    deps.onEvent({
      userId,
      origin: "web",
      status: "success",
      eventType: finalStatus === "updated" ? "exercise.updated" : "exercise.created",
      detail: finalStatus === "updated"
        ? `Exercício ${created.activityType} atualizado pelo usuário.`
        : `Exercício ${created.activityType} registrado com gasto de ${roundNutritionValue(created.caloriesBurned)} kcal.`,
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
    externalProvider?: string;
    externalId?: string;
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
      externalProvider: input.externalProvider?.trim().toLowerCase() || existing.externalProvider || null,
      externalId: normalizeExternalId(input.externalId) || existing.externalId || null,
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
    listExercisesInRange,
    createExercise,
    updateExercise,
    removeExercise,
    clearMemory,
  };
}

export type ExercisesService = ReturnType<typeof createExercisesService>;