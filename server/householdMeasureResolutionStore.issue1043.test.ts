import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ getDb: getDbMock }));
vi.mock("./privacy", () => ({ safeLogDetail: (error: unknown) => String(error) }));

import {
  loadPersistedHouseholdMeasureResolution,
  persistHouseholdMeasureResolution,
  persistUserLearnedHouseholdMeasure,
} from "./householdMeasureResolutionStore";

type InsertedPreference = {
  userId: number;
  preferenceKey: string;
  preferenceValue: string;
};

function fakeDb(state: { inserted: InsertedPreference[]; rows?: InsertedPreference[] }) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => (state.rows ?? []).map(row => ({
          preferenceKey: row.preferenceKey,
          preferenceValue: row.preferenceValue,
        }))),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((value: InsertedPreference) => ({
        onDuplicateKeyUpdate: vi.fn(async () => {
          const existingIndex = state.inserted.findIndex(row =>
            row.userId === value.userId && row.preferenceKey === value.preferenceKey
          );
          if (existingIndex >= 0) state.inserted[existingIndex] = value;
          else state.inserted.push(value);
        }),
      })),
    })),
  };
}

describe("householdMeasureResolutionStore (#1043)", () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it("faz upsert idempotente do aprendizado do usuário em vez de criar duplicatas", async () => {
    const state = { inserted: [] as InsertedPreference[] };
    getDbMock.mockResolvedValue(fakeDb(state));
    const learning = {
      userId: 11,
      foodName: "Presunto cozido",
      originalQuantity: 4,
      originalUnit: "fatias",
      correctedQuantity: 72,
      correctedUnit: "g",
    };

    await persistUserLearnedHouseholdMeasure(learning);
    await persistUserLearnedHouseholdMeasure(learning);

    expect(state.inserted).toHaveLength(1);
    const record = JSON.parse(state.inserted[0].preferenceValue);
    expect(record).toEqual(expect.objectContaining({
      kind: "user_learned",
      measureQuantity: 4,
      grams: 72,
      unit: "fatia",
      expiresAt: null,
    }));
  });

  it("isola pelo usuário e mantém identidades/variantes diferentes em chaves distintas", async () => {
    const state = { inserted: [] as InsertedPreference[] };
    getDbMock.mockResolvedValue(fakeDb(state));

    await persistUserLearnedHouseholdMeasure({
      userId: 11,
      foodName: "Presunto cozido",
      brand: "Marca A",
      originalQuantity: 2,
      originalUnit: "fatia",
      correctedQuantity: 36,
      correctedUnit: "g",
    });
    await persistUserLearnedHouseholdMeasure({
      userId: 12,
      foodName: "Presunto cozido",
      brand: "Marca A",
      originalQuantity: 2,
      originalUnit: "fatia",
      correctedQuantity: 40,
      correctedUnit: "g",
    });
    await persistUserLearnedHouseholdMeasure({
      userId: 11,
      foodName: "Presunto cozido",
      brand: "Marca B",
      originalQuantity: 2,
      originalUnit: "fatia",
      correctedQuantity: 44,
      correctedUnit: "g",
    });

    expect(state.inserted).toHaveLength(3);
    expect(state.inserted.map(row => row.userId).sort()).toEqual([11, 11, 12]);
    const user11Keys = state.inserted.filter(row => row.userId === 11).map(row => row.preferenceKey);
    expect(new Set(user11Keys).size).toBe(2);
  });

  it("atualiza a relação aprendida quando o mesmo usuário corrige novamente", async () => {
    const state = { inserted: [] as InsertedPreference[] };
    getDbMock.mockResolvedValue(fakeDb(state));

    const base = {
      userId: 11,
      foodName: "Queijo mussarela",
      originalQuantity: 2,
      originalUnit: "fatias",
      correctedUnit: "g",
    };
    await persistUserLearnedHouseholdMeasure({ ...base, correctedQuantity: 40 });
    await persistUserLearnedHouseholdMeasure({ ...base, correctedQuantity: 44 });

    expect(state.inserted).toHaveLength(1);
    expect(JSON.parse(state.inserted[0].preferenceValue).grams).toBe(44);
  });

  it("trata resolução expirada como miss para permitir nova pesquisa", async () => {
    const state = { inserted: [] as InsertedPreference[] };
    getDbMock.mockResolvedValue(fakeDb(state));
    await persistHouseholdMeasureResolution({
      userId: 11,
      foodName: "Presunto cozido",
      quantity: 1,
      unit: "fatia",
      kind: "contextual_estimate",
      grams: 18,
      evidence: "1 fatia de presunto cozido pesa 18 g.",
      sourceUrls: ["https://example.com/presunto"],
      referenceCount: 1,
      verifiedAt: new Date("2026-07-01T00:00:00.000Z"),
      expiresAt: new Date("2026-08-01T00:00:00.000Z"),
    });
    state.rows = [...state.inserted];

    const loaded = await loadPersistedHouseholdMeasureResolution({
      userId: 11,
      foodName: "Presunto cozido",
      quantity: 3,
      unit: "fatia",
    }, ["contextual_estimate"], new Date("2026-09-03T12:00:00.000Z"));

    expect(loaded).toBeNull();
  });

  it("não aprende a partir de correção que não converte uma medida contável para massa/volume", async () => {
    const state = { inserted: [] as InsertedPreference[] };
    getDbMock.mockResolvedValue(fakeDb(state));

    expect(await persistUserLearnedHouseholdMeasure({
      userId: 11,
      foodName: "Presunto cozido",
      originalQuantity: 4,
      originalUnit: "fatias",
      correctedQuantity: 3,
      correctedUnit: "fatias",
    })).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });
});
