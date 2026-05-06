import { getUserGamification, updateUserGamificationSettings } from "../../db";

export function getGamification(userId: number) {
  return getUserGamification(userId);
}

export function updateGamificationSettings(userId: number, input: { enabled: boolean }) {
  return updateUserGamificationSettings(userId, input.enabled);
}
