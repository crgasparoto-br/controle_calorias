import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { canUseMemoryPersistenceFallback } from "../../repositories/memoryFallback";
import type { WaterGoalRecord, WaterLogRecord, WaterRepository } from "../../repositories/waterRepository";

export type WaterGoalEntry = WaterGoalRecord;
export type WaterLogEntry = WaterLogRecord;

export function sumWater(items: WaterLogEntry[]) {
  return items.reduce((acc, item) => acc + Number(item.amountMl ?? 0), 0);
}

export function createWaterService(deps: {
  waterRepository: WaterRepository;
  buildOccurredAtRange: (date: string, timeZone: string) => { startAt: Date; endAt: Date };
  onEvent: (entry: { userId: number; origin: "web"; status: "success"; eventType: string; detail: string }) => void;
}) {
  const waterGoalStore = new Map<number, WaterGoalEntry>();
  const waterLogStore = new Map<number, WaterLogEntry[]>();
  let waterGoalIdSequence = 1;
  let waterLogIdSequence = 1;

  async function getStoredWaterGoal(userId: number) {
    const dbGoal = await deps.waterRepository.findGoalByUserId(userId);
    if (dbGoal) {
      if (canUseMemoryPersistenceFallback()) {
        waterGoalStore.set(userId, dbGoal);
      }
      return dbGoal;
    }

    if (canUseMemoryPersistenceFallback()) {
      const stored = waterGoalStore.get(userId);
      if (stored) {
        return stored;
      }
    }

    const created: WaterGoalEntry = {
      id: waterGoalIdSequence++,
      userId,
      dailyTargetMl: 2500,
      createdAt: Date.now(),
      updatedAt: new Date(),
    };
    if (canUseMemoryPersistenceFallback()) {
      waterGoalStore.set(userId, created);
    }
    return created;
  }

  async function getStoredWaterLogs(userId: number) {
    const dbLogs = await deps.waterRepository.findLogsByUserId(userId);
    if (dbLogs) {
      if (canUseMemoryPersistenceFallback()) {
        waterLogStore.set(userId, dbLogs);
      }
      return dbLogs;
    }

    return canUseMemoryPersistenceFallback() ? waterLogStore.get(userId) ?? [] : [];
  }

  async function getWaterGoal(userId: number) {
    return getStoredWaterGoal(userId);
  }

  async function listWaterLogs(userId: number) {
    const logs = await getStoredWaterLogs(userId);
    return logs.slice().sort((a, b) => b.occurredAt - a.occurredAt);
  }

  async function listWaterLogsByDate(userId: number, date: string, timeZone = DEFAULT_APP_TIME_ZONE) {
    const range = deps.buildOccurredAtRange(date, timeZone);
    const dbLogs = await deps.waterRepository.findLogsByUserIdAndRange(userId, range.startAt, range.endAt);
    const logs = dbLogs ?? (canUseMemoryPersistenceFallback() ? waterLogStore.get(userId) ?? [] : []);
    return logs
      .filter(log => getDateKeyInTimeZone(Number(log.occurredAt), timeZone) === date)
      .slice()
      .sort((a, b) => b.occurredAt - a.occurredAt);
  }

  async function listWaterLogsInRange(userId: number, startAt: Date, endAt: Date) {
    const dbLogs = await deps.waterRepository.findLogsByUserIdAndRange(userId, startAt, endAt);
    const logs = dbLogs ?? (canUseMemoryPersistenceFallback() ? waterLogStore.get(userId) ?? [] : []);
    return logs
      .filter(log => Number(log.occurredAt) >= startAt.getTime() && Number(log.occurredAt) < endAt.getTime())
      .slice()
      .sort((a, b) => b.occurredAt - a.occurredAt);
  }

  async function updateWaterGoal(userId: number, dailyTargetMl: number) {
    const current = await getStoredWaterGoal(userId);
    const updated: WaterGoalEntry = {
      ...current,
      dailyTargetMl,
      updatedAt: new Date(),
    };
    if (canUseMemoryPersistenceFallback()) {
      waterGoalStore.set(userId, updated);
    }
    await deps.waterRepository.upsertGoal(updated);
    deps.onEvent({
      userId,
      origin: "web",
      status: "success",
      eventType: "water.goal_updated",
      detail: `Meta diária de água atualizada para ${dailyTargetMl} ml.`,
    });
    return updated;
  }

  async function createWaterLog(userId: number, input: { amountMl: number; occurredAt: string }) {
    const created: WaterLogEntry = {
      id: waterLogIdSequence++,
      userId,
      amountMl: input.amountMl,
      occurredAt: new Date(input.occurredAt).getTime(),
      createdAt: Date.now(),
      updatedAt: new Date(),
    };

    const current = await listWaterLogs(userId);
    if (canUseMemoryPersistenceFallback()) {
      waterLogStore.set(userId, [created, ...current.filter(item => item.id !== created.id)]);
    }
    await deps.waterRepository.insertLog(created);
    deps.onEvent({
      userId,
      origin: "web",
      status: "success",
      eventType: "water.logged",
      detail: `Consumo de ${created.amountMl} ml de água registrado.`,
    });
    return created;
  }

  async function removeWaterLog(userId: number, waterLogId: number) {
    const current = await listWaterLogs(userId);
    const existing = current.find(item => item.id === waterLogId);
    if (!existing) {
      throw new Error("Registro de água não encontrado.");
    }

    if (canUseMemoryPersistenceFallback()) {
      waterLogStore.set(userId, current.filter(item => item.id !== waterLogId));
    }
    await deps.waterRepository.deleteLog(userId, waterLogId);
    deps.onEvent({
      userId,
      origin: "web",
      status: "success",
      eventType: "water.deleted",
      detail: `Registro de água de ${existing.amountMl} ml removido pelo usuário.`,
    });
    return { success: true };
  }

  function clearMemory(userId: number) {
    waterGoalStore.delete(userId);
    waterLogStore.delete(userId);
  }

  return {
    getWaterGoal,
    listWaterLogs,
    listWaterLogsByDate,
    listWaterLogsInRange,
    updateWaterGoal,
    createWaterLog,
    removeWaterLog,
    clearMemory,
  };
}

export type WaterService = ReturnType<typeof createWaterService>;
