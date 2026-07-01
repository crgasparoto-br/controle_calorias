import { describe, expect, it } from "vitest";
import { listSyncedHealthRecords } from "../syncedRecords";
import { getStravaExternalExerciseId, mapStravaExercisesToSyncedHealthRecords } from "./syncedExercises";

describe("mapStravaExercisesToSyncedHealthRecords", () => {
  it("converte exercícios importados do Strava em registros sincronizados", () => {
    const records = mapStravaExercisesToSyncedHealthRecords([
      {
        id: 42,
        activityType: "Corrida",
        durationMinutes: 38,
        caloriesBurned: 410,
        occurredAt: "2026-06-29T10:00:00Z",
        createdAt: "2026-06-29T10:05:00Z",
        updatedAt: "2026-06-29T10:06:00Z",
        notes: "Importado automaticamente do Strava. Referencia externa: strava:123456. Tipo Strava: Run. Distancia: 7,20 km. Calorias: 410 kcal.",
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "123456:activity",
      source: "strava",
      dataType: "activity",
      measuredAt: "2026-06-29T10:00:00.000Z",
      value: 38,
      unit: "minutes",
      activityType: "Corrida",
      metadata: expect.objectContaining({
        externalId: "123456",
        importedExerciseId: 42,
        calories: 410,
        caloriesSource: "exercise_log",
        caloriesOrigin: "synced_exercise",
        sourceStatus: "synced",
        sportType: "Run",
        distanceMeters: 7200,
      }),
    });
  });

  it("ignora exercícios sem referência externa do Strava", () => {
    const records = mapStravaExercisesToSyncedHealthRecords([
      {
        id: 1,
        activityType: "Caminhada",
        durationMinutes: 20,
        caloriesBurned: 100,
        occurredAt: "2026-06-29T10:00:00Z",
        notes: "Registro manual",
      },
    ]);

    expect(records).toEqual([]);
  });

  it("mantém o exercício mais recente para a mesma referência externa", () => {
    const records = mapStravaExercisesToSyncedHealthRecords([
      {
        id: 1,
        activityType: "Corrida",
        durationMinutes: 20,
        caloriesBurned: 200,
        occurredAt: "2026-06-29T10:00:00Z",
        updatedAt: "2026-06-29T10:10:00Z",
        notes: "Referencia externa: strava:abc123.",
      },
      {
        id: 2,
        activityType: "Corrida",
        durationMinutes: 25,
        caloriesBurned: 250,
        occurredAt: "2026-06-29T10:00:00Z",
        updatedAt: "2026-06-29T10:20:00Z",
        notes: "Referencia externa: strava:abc123.",
      },
    ]);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "abc123:activity",
      value: 25,
      metadata: expect.objectContaining({ importedExerciseId: 2, calories: 250 }),
    });
  });

  it("permite que a tela filtre atividade Strava salva como exercício", () => {
    const records = mapStravaExercisesToSyncedHealthRecords([
      {
        id: 42,
        activityType: "Corrida",
        durationMinutes: 38,
        caloriesBurned: 410,
        occurredAt: "2026-06-29T10:00:00Z",
        notes: "Importado automaticamente do Strava. Referencia externa: strava:123456. Tipo Strava: Run. Calorias: 410 kcal.",
      },
    ]);

    const result = listSyncedHealthRecords(records, {
      provider: "strava",
      dataType: "activity",
      activityType: "run",
      from: "2026-06-29T00:00:00Z",
      to: "2026-06-30T00:00:00Z",
      limit: 20,
      offset: 0,
    });

    expect(result.items).toHaveLength(1);
    expect(result.totals).toMatchObject({
      activityMinutes: 38,
      activityCount: 1,
      energyBurnedCalories: 410,
    });
    expect(result.dataTypes).toContain("energy_burned");
  });

  it("extrai a referência externa do Strava das observações", () => {
    expect(getStravaExternalExerciseId({ notes: "Referencia externa: strava:987654." })).toBe("987654");
    expect(getStravaExternalExerciseId({ notes: null })).toBeNull();
  });
});
