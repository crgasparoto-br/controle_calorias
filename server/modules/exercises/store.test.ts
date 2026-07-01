import { describe, expect, it, vi } from "vitest";
import { createExercisesService, sumExercises } from "./store";
import type { ExercisesRepository } from "../../repositories/exercisesRepository";

function createFakeExercisesRepository(overrides: Partial<ExercisesRepository> = {}): ExercisesRepository {
  return {
    findByUserId: vi.fn(async () => null),
    findByUserIdAndRange: vi.fn(async () => null),
    insert: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    ...overrides,
  } as ExercisesRepository;
}

function buildOccurredAtRange(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCDate(end.getUTCDate() + 2);
  return { startAt: start, endAt: end };
}

function createService(overrides: Partial<Parameters<typeof createExercisesService>[0]> = {}) {
  return createExercisesService({
    exercisesRepository: createFakeExercisesRepository(),
    buildOccurredAtRange,
    onEvent: vi.fn(),
    ...overrides,
  });
}

const baseInput = {
  activityType: "Corrida",
  durationMinutes: 30,
  caloriesBurned: 300,
  occurredAt: "2026-06-01T10:00:00.000Z",
};

describe("exercises service", () => {
  it("returns an empty list when the user has no exercises", async () => {
    const service = createService();
    expect(await service.listExercises(1)).toEqual([]);
  });

  it("creates and lists exercises sorted from most to least recent", async () => {
    const service = createService();
    await service.createExercise(1, baseInput);
    await service.createExercise(1, { ...baseInput, activityType: "Bike", occurredAt: "2026-06-01T12:00:00.000Z" });

    const exercises = await service.listExercises(1);
    expect(exercises.map(exercise => exercise.activityType)).toEqual(["Bike", "Corrida"]);
  });

  it("filters exercises by date", async () => {
    const service = createService();
    await service.createExercise(1, baseInput);
    await service.createExercise(1, { ...baseInput, activityType: "Bike", occurredAt: "2026-06-02T10:00:00.000Z" });

    const exercisesForDay = await service.listExercisesByDate(1, "2026-06-01");
    expect(exercisesForDay).toHaveLength(1);
    expect(exercisesForDay[0].activityType).toBe("Corrida");
  });

  it("keeps data isolated between different users", async () => {
    const service = createService();
    await service.createExercise(1, baseInput);
    await service.createExercise(2, { ...baseInput, activityType: "Natação" });

    expect((await service.listExercises(1)).map(e => e.activityType)).toEqual(["Corrida"]);
    expect((await service.listExercises(2)).map(e => e.activityType)).toEqual(["Natação"]);
  });

  it("updates an existing exercise", async () => {
    const service = createService();
    const created = await service.createExercise(1, baseInput);

    const updated = await service.updateExercise(1, {
      exerciseId: created.id,
      ...baseInput,
      activityType: "Corrida atualizada",
    });

    expect(updated.activityType).toBe("Corrida atualizada");
    expect((await service.listExercises(1))[0].activityType).toBe("Corrida atualizada");
  });

  it("throws when updating or removing an exercise that does not exist", async () => {
    const service = createService();
    await expect(service.updateExercise(1, { exerciseId: 999, ...baseInput })).rejects.toThrow("Exercício não encontrado.");
    await expect(service.removeExercise(1, 999)).rejects.toThrow("Exercício não encontrado.");
  });

  it("clears in-memory exercises for a user", async () => {
    const service = createService();
    await service.createExercise(1, baseInput);

    service.clearMemory(1);

    expect(await service.listExercises(1)).toEqual([]);
  });

  it("prefers persisted data returned by the repository over memory", async () => {
    const repository = createFakeExercisesRepository({
      findByUserId: vi.fn(async () => [
        {
          id: 50,
          userId: 1,
          activityType: "Persistido",
          durationMinutes: 45,
          caloriesBurned: 400,
          notes: null,
          occurredAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: new Date(),
        },
      ]),
    });
    const service = createService({ exercisesRepository: repository });

    const exercises = await service.listExercises(1);
    expect(exercises).toHaveLength(1);
    expect(exercises[0].activityType).toBe("Persistido");
  });
});

describe("sumExercises", () => {
  it("sums calories burned across exercise entries", () => {
    const total = sumExercises([
      { id: 1, userId: 1, activityType: "a", durationMinutes: 1, caloriesBurned: 100, occurredAt: 0, createdAt: 0, updatedAt: new Date() },
      { id: 2, userId: 1, activityType: "b", durationMinutes: 1, caloriesBurned: 250, occurredAt: 0, createdAt: 0, updatedAt: new Date() },
    ]);
    expect(total).toBe(350);
  });
});
