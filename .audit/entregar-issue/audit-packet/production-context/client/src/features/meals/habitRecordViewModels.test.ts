import { describe, expect, it } from "vitest";

import { buildExerciseDayGroups, buildWaterLogDayGroups } from "./habitRecordViewModels";

describe("habit record view models", () => {
  it("groups water logs by local day and summarizes daily amount", () => {
    const groups = buildWaterLogDayGroups([
      { id: 1, amountMl: 300, occurredAt: "2026-06-09T23:30:00.000Z" },
      { id: 2, amountMl: 700, occurredAt: "2026-06-10T10:00:00.000Z" },
      { id: 3, amountMl: 500, occurredAt: "2026-06-11T01:30:00.000Z" },
    ], { timeZone: "America/Sao_Paulo" });

    expect(groups.map(group => group.date)).toEqual(["2026-06-10", "2026-06-09"]);
    expect(groups[0].totalMl).toBe(1200);
    expect(groups[0].records.map(record => record.id)).toEqual([3, 2]);
    expect(groups[1].totalMl).toBe(300);
  });

  it("groups exercises by local day and summarizes calories, duration and count", () => {
    const groups = buildExerciseDayGroups([
      { id: 1, activityType: "Corrida", durationMinutes: 30, caloriesBurned: 250, occurredAt: "2026-06-09T12:00:00.000Z" },
      { id: 2, activityType: "Musculação", durationMinutes: 45, caloriesBurned: 180, occurredAt: "2026-06-10T18:00:00.000Z" },
      { id: 3, activityType: "Caminhada", durationMinutes: 20, caloriesBurned: 90, occurredAt: "2026-06-10T20:00:00.000Z" },
    ], { timeZone: "America/Sao_Paulo" });

    expect(groups.map(group => group.date)).toEqual(["2026-06-10", "2026-06-09"]);
    expect(groups[0]).toEqual(expect.objectContaining({
      totalCalories: 270,
      totalMinutes: 65,
      activityCount: 2,
    }));
    expect(groups[0].records.map(record => record.id)).toEqual([3, 2]);
  });

  it("supports chronological day ordering when requested", () => {
    const groups = buildWaterLogDayGroups([
      { id: 1, amountMl: 300, occurredAt: "2026-06-10T10:00:00.000Z" },
      { id: 2, amountMl: 500, occurredAt: "2026-06-09T10:00:00.000Z" },
    ], { timeZone: "America/Sao_Paulo", sortDirection: "asc" });

    expect(groups.map(group => group.date)).toEqual(["2026-06-09", "2026-06-10"]);
  });
});
