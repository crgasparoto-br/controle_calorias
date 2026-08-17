import { and, eq } from "drizzle-orm";
import { professionalProfiles } from "../../drizzle/professional-schema";
import { userPreferences } from "../../drizzle/schema";
import { PROFESSIONAL_PROFILE_PREFERENCE_KEY } from "../modules/professionals/persistence";

type DbProvider = () => Promise<any | null>;

export async function deleteProfessionalProfilePersistence(input: {
  getDb: DbProvider;
  userId: number;
}) {
  const db = await input.getDb();
  if (!db) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "A persistência da Área Profissional está temporariamente indisponível."
      );
    }
    return { persisted: false as const };
  }

  await db.transaction(async (tx: any) => {
    await tx
      .delete(userPreferences)
      .where(
        and(
          eq(userPreferences.userId, input.userId),
          eq(
            userPreferences.preferenceKey,
            PROFESSIONAL_PROFILE_PREFERENCE_KEY
          )
        )
      );
    await tx
      .delete(professionalProfiles)
      .where(eq(professionalProfiles.userId, input.userId));
  });

  return { persisted: true as const };
}
