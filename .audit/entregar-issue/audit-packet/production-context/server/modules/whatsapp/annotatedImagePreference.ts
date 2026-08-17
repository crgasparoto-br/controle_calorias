import { and, eq } from "drizzle-orm";
import { userPreferences } from "../../../drizzle/schema";
import { getDb, logInferenceEvent } from "../../db";

export const ANNOTATED_IMAGE_PREFERENCE_KEY = "whatsapp_annotated_image_enabled";

export type AnnotatedImagePreferenceResolution = {
  enabled: boolean;
  readFailed: boolean;
};

export function parseAnnotatedImagePreference(value: string | null | undefined) {
  return value === "true";
}

export async function getAnnotatedImagePreference(userId: number): Promise<AnnotatedImagePreferenceResolution> {
  try {
    const db = await getDb();
    if (!db) return { enabled: false, readFailed: false };

    const rows = await db
      .select({ preferenceValue: userPreferences.preferenceValue })
      .from(userPreferences)
      .where(and(
        eq(userPreferences.userId, userId),
        eq(userPreferences.preferenceKey, ANNOTATED_IMAGE_PREFERENCE_KEY),
      ))
      .limit(1);

    return {
      enabled: parseAnnotatedImagePreference(rows[0]?.preferenceValue),
      readFailed: false,
    };
  } catch {
    logInferenceEvent({
      userId,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.annotated_image_preference_read_failed",
      detail: "Preferência de imagem auxiliar indisponível; fallback seguro desabilitado aplicado.",
    });
    return { enabled: false, readFailed: true };
  }
}

export async function setAnnotatedImagePreference(userId: number, enabled: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Não foi possível salvar a preferência de imagem anotada.");

  const now = new Date();
  await db.insert(userPreferences).values({
    userId,
    preferenceKey: ANNOTATED_IMAGE_PREFERENCE_KEY,
    preferenceValue: enabled ? "true" : "false",
    createdAt: now,
    updatedAt: now,
  }).onDuplicateKeyUpdate({
    set: { preferenceValue: enabled ? "true" : "false", updatedAt: now },
  });

  return { enabled };
}
