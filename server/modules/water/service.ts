import {
  createUserWaterLog,
  getUserWaterGoal,
  listUserWaterLogs,
  removeUserWaterLog,
  updateUserWaterGoal,
} from "../../db";
import { WaterGoalInput, WaterLogInput } from "./schemas";

export async function getWaterGoal(userId: number) {
  return getUserWaterGoal(userId);
}

export async function updateWaterGoal(userId: number, input: WaterGoalInput) {
  return updateUserWaterGoal(userId, input.dailyTargetMl);
}

export async function listWaterLogs(userId: number) {
  return listUserWaterLogs(userId);
}

export async function createWaterLog(userId: number, input: WaterLogInput) {
  return createUserWaterLog(userId, input);
}

export async function removeWaterLog(userId: number, waterLogId: number) {
  return removeUserWaterLog(userId, waterLogId);
}
