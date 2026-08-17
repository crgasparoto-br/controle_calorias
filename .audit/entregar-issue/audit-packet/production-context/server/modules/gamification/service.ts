import { getUserGamification, updateUserGamificationSettings } from "../../db";

export function getGamification(userId: number, timeZone: string) {
  return getUserGamification(userId, undefined, timeZone);
}

export function updateGamificationSettings(userId: number, input: { enabled: boolean }) {
  return updateUserGamificationSettings(userId, input.enabled);
}
