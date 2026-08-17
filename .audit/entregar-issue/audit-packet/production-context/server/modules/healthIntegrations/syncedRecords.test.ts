import { describe, expect, it } from "vitest";
import { listSyncedHealthRecords } from "./syncedRecords";

const records = [
  {
    id: "run-1:activity",
    source: "strava" as const,
    dataType: "activity" as const,
    measuredAt: "2026-06-03T10:00:00Z",
    value: 35,
    unit: "minutes",
    activityType: "Corrida",
    metadata: {
      externalId: "run-1",
      name: "Corrida matinal",
      sportType: "Run",
      distanceMeters: 7200,
    },
  },
  {
    id: "run-1:energy",
    source: "strava" as const,
    dataType: "energy_burned" as const,
    measuredAt: "2026-06-03T10:00:00Z",
    value: 420,
    unit: "kcal",
    activityType: "Corrida",
    metadata: {
      externalId: "run-1",
      name: "Corrida matinal",
      sportType: "Run",
      caloriesSource: "strava",
    },
  },
  {
    id: "walk-1:activity",
    source: "mock" as const,
    dataType: "activity" as const,
    measuredAt: "2026-06-01T12:00:00Z",
    value: 20,
    unit: "minutes",
    activityType: "Caminhada",
    metadata: {
      name: "Caminhada curta",
    },
  },
  {
    id: "steps-1",
    source: "mock" as const,
    dataType: "steps" as const,
    measuredAt: "2026-05-30T12:00:00Z",
    value: 6500,
    unit: "count",
    metadata: null,
  },
];

describe("listSyncedHealthRecords", () => {
  it("filtra por provider, tipo, texto e período", () => {
    const result = listSyncedHealthRecords(records, {
      provider: "strava",
      dataType: "activity",
      q: "matinal",
      from: "2026-06-01T00:00:00Z",
      to: "2026-06-04T00:00:00Z",
      limit: 20,
      offset: 0,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "run-1:activity",
      source: "strava",
      dataType: "activity",
      metadata: expect.objectContaining({
        calories: 420,
        caloriesSource: "strava",
      }),
    });
    expect(result.total).toBe(1);
    expect(result.totals).toMatchObject({
      activityMinutes: 35,
      energyBurnedCalories: 420,
      steps: 0,
    });
  });

  it("consolida atividade e gasto em um único item", () => {
    const result = listSyncedHealthRecords(records, { limit: 20, offset: 0 });

    expect(result.items.map(record => record.id)).toEqual(["run-1:activity", "walk-1:activity", "steps-1"]);
    expect(result.total).toBe(3);
    expect(result.totals).toMatchObject({
      activityMinutes: 55,
      energyBurnedCalories: 420,
      steps: 6500,
    });
  });

  it("mantém filtro de calorias apontando para atividades consolidadas", () => {
    const result = listSyncedHealthRecords(records, {
      dataType: "energy_burned",
      limit: 20,
      offset: 0,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "run-1:activity",
      dataType: "activity",
      metadata: expect.objectContaining({ calories: 420 }),
    });
    expect(result.totals.energyBurnedCalories).toBe(420);
  });

  it("pagina resultados e retorna o próximo offset", () => {
    const firstPage = listSyncedHealthRecords(records, { limit: 2, offset: 0 });
    const secondPage = listSyncedHealthRecords(records, { limit: 2, offset: 2 });

    expect(firstPage.items.map(record => record.id)).toEqual(["run-1:activity", "walk-1:activity"]);
    expect(firstPage.nextOffset).toBe(2);
    expect(secondPage.items.map(record => record.id)).toEqual(["steps-1"]);
    expect(secondPage.nextOffset).toBeNull();
  });

  it("retorna lista vazia quando nenhum filtro encontra registro", () => {
    const result = listSyncedHealthRecords(records, {
      dataType: "sleep",
      limit: 20,
      offset: 0,
    });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.nextOffset).toBeNull();
  });
});
