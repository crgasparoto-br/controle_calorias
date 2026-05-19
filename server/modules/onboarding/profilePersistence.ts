import { eq } from "drizzle-orm";
import { userProfiles } from "../../../drizzle/schema";
import { getDb } from "../../db";
import type { OnboardingInput } from "./schemas";

export async function persistOnboardingBirthDate(userId: number, input: OnboardingInput) {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(userProfiles)
      .set({
        birthDate: input.birthDate,
        ageYears: input.ageYears,
        updatedAt: new Date(),
      })
      .where(eq(userProfiles.userId, userId));
  } catch (error) {
    console.warn("[Database] Birth date persistence skipped:", error);
  }
}
