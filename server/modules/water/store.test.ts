import { describe, expect, it, vi } from "vitest";
import { createWaterService, sumWater } from "./store";
import type { WaterRepository } from "../../repositories/waterRepository";

function createFakeWaterRepository(overrides: Partial<WaterRepository> = {}): WaterRepository {
  return {
    findGoalByUserId: vi.fn(async () => null),
    upsertGoal: vi.fn(async () => undefined),
    findLogsByUserId: vi.fn(async () => null),
    findLogsByUserIdAndRange: vi.fn(async () => null),
    insertLog: vi.fn(async () => undefined),
    deleteLog: vi.fn(async () => undefined),
    ...overrides,
  } as WaterRepository;
}

function buildOccurredAtRange(date: string) {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start);
  start.setUTCDate(start.getUTCDate() - 1);
  end.setUTCDate(end.getUTCDate() + 2);
  return { startAt: start, endAt: end };
}

function createService(overrides: Partial<Parameters<typeof createWaterService>[0]> = {}) {
  return createWaterService({
    waterRepository: createFakeWaterRepository(),
    buildOccurredAtRange,
    onEvent: vi.fn(),
    ...overrides,
  });
}

describe("water service", () => {
  it("creates a default goal in memory when there is no database and no prior goal", async () => {
    const service = createService();
    const goal = await service.getWaterGoal(1);
    expect(goal.dailyTargetMl).toBe(2500);
  });

  it("registers and lists water logs sorted from most to least recent", async () => {
    const service = createService();
    await service.createWaterLog(1, { amountMl: 200, occurredAt: "2026-06-01T10:00:00.000Z" });
    await service.createWaterLog(1, { amountMl: 300, occurredAt: "2026-06-01T12:00:00.000Z" });

    const logs = await service.listWaterLogs(1);
    expect(logs.map(log => log.amountMl)).toEqual([300, 200]);
  });

  it("returns an empty list when the user has no logs for the requested day", async () => {
    const service = createService();
    const logs = await service.listWaterLogsByDate(1, "2026-06-01");
    expect(logs).toEqual([]);
  });

  it("filters logs by date and keeps other days out", async () => {
    const service = createService();
    await service.createWaterLog(1, { amountMl: 200, occurredAt: "2026-06-01T10:00:00.000Z" });
    await service.createWaterLog(1, { amountMl: 500, occurredAt: "2026-06-02T10:00:00.000Z" });

    const logs = await service.listWaterLogsByDate(1, "2026-06-01");
    expect(logs).toHaveLength(1);
    expect(logs[0].amountMl).toBe(200);
  });

  it("keeps data isolated between different users", async () => {
    const service = createService();
    await service.createWaterLog(1, { amountMl: 200, occurredAt: "2026-06-01T10:00:00.000Z" });
    await service.createWaterLog(2, { amountMl: 900, occurredAt: "2026-06-01T10:00:00.000Z" });

    const userOneLogs = await service.listWaterLogs(1);
    const userTwoLogs = await service.listWaterLogs(2);
    expect(userOneLogs.map(log => log.amountMl)).toEqual([200]);
    expect(userTwoLogs.map(log => log.amountMl)).toEqual([900]);
  });

  it("throws when removing a water log that does not exist", async () => {
    const service = createService();
    await expect(service.removeWaterLog(1, 999)).rejects.toThrow("Registro de água não encontrado.");
  });

  it("clears in-memory goal and logs for a user", async () => {
    const service = createService();
    await service.updateWaterGoal(1, 3000);
    await service.createWaterLog(1, { amountMl: 200, occurredAt: "2026-06-01T10:00:00.000Z" });

    service.clearMemory(1);

    const goal = await service.getWaterGoal(1);
    const logs = await service.listWaterLogs(1);
    expect(goal.dailyTargetMl).toBe(2500);
    expect(logs).toEqual([]);
  });

  it("prefers persisted data returned by the repository over memory", async () => {
    const repository = createFakeWaterRepository({
      findGoalByUserId: vi.fn(async () => ({
        id: 10,
        userId: 1,
        dailyTargetMl: 4000,
        createdAt: Date.now(),
        updatedAt: new Date(),
      })),
    });
    const service = createService({ waterRepository: repository });

    const goal = await service.getWaterGoal(1);
    expect(goal.dailyTargetMl).toBe(4000);
  });
});

describe("sumWater", () => {
  it("sums the amount consumed across log entries", () => {
    const total = sumWater([
      { id: 1, userId: 1, amountMl: 200, occurredAt: 0, createdAt: 0, updatedAt: new Date() },
      { id: 2, userId: 1, amountMl: 300, occurredAt: 0, createdAt: 0, updatedAt: new Date() },
    ]);
    expect(total).toBe(500);
  });
});
