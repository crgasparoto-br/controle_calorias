import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import {
  professionalPatientAuthorizations,
  professionalProfiles,
} from "../drizzle/professional-schema";
import { userPreferences } from "../drizzle/schema";
import { getDb } from "../server/db";
import {
  PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
  PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
  PROFESSIONAL_PROFILE_PREFERENCE_KEY,
  parseLegacyProfessionalAccesses,
  parseLegacyProfessionalProfile,
} from "../server/modules/professionals/persistence";
import { migrateAllLegacyProfessionalData } from "../server/modules/professionals/persistenceService";

const legacyKeys = [
  PROFESSIONAL_PROFILE_PREFERENCE_KEY,
  PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
  PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
] as const;

async function verifyCanonicalCoverage(db: any, rows: any[]) {
  const missingProfiles: number[] = [];
  const expectedAuthorizationIds = new Set<string>();
  let invalidPreferences = 0;

  for (const row of rows) {
    if (row.preferenceKey === PROFESSIONAL_PROFILE_PREFERENCE_KEY) {
      const parsed = parseLegacyProfessionalProfile(
        row.userId,
        row.preferenceValue,
        new Date(row.updatedAt ?? row.createdAt ?? Date.now())
      );
      if (!parsed.value) {
        invalidPreferences += 1;
        continue;
      }
      const [profile] = await db
        .select({ userId: professionalProfiles.userId })
        .from(professionalProfiles)
        .where(eq(professionalProfiles.userId, row.userId))
        .limit(1);
      if (!profile) missingProfiles.push(row.userId);
      continue;
    }

    const parsed = parseLegacyProfessionalAccesses(
      row.userId,
      row.preferenceKey,
      row.preferenceValue
    );
    if (!parsed.value) {
      invalidPreferences += 1;
      continue;
    }
    if (parsed.issue) invalidPreferences += 1;
    for (const access of parsed.value) expectedAuthorizationIds.add(access.id);
  }

  const ids = [...expectedAuthorizationIds];
  const canonicalIds = new Set<string>();
  if (ids.length) {
    const authorizations = await db
      .select({ id: professionalPatientAuthorizations.id })
      .from(professionalPatientAuthorizations)
      .where(inArray(professionalPatientAuthorizations.id, ids));
    for (const authorization of authorizations)
      canonicalIds.add(authorization.id);
  }
  const missingAuthorizations = ids.filter(id => !canonicalIds.has(id));

  return { invalidPreferences, missingProfiles, missingAuthorizations };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db)
    throw new Error(
      "DATABASE_URL indisponível para aposentar a persistência legada profissional."
    );

  const migration = await migrateAllLegacyProfessionalData();
  const rows = await db
    .select()
    .from(userPreferences)
    .where(inArray(userPreferences.preferenceKey, [...legacyKeys]));
  const verification = await verifyCanonicalCoverage(db, rows);

  if (migration.invalidPreferences > 0 || verification.invalidPreferences > 0) {
    throw new Error(
      "Existem preferências profissionais legadas inválidas; nenhuma exclusão foi executada."
    );
  }
  if (
    verification.missingProfiles.length ||
    verification.missingAuthorizations.length
  ) {
    throw new Error(
      `A cobertura canônica está incompleta: perfis=${verification.missingProfiles.length}, autorizações=${verification.missingAuthorizations.length}.`
    );
  }

  if (apply && rows.length) {
    await db
      .delete(userPreferences)
      .where(inArray(userPreferences.preferenceKey, [...legacyKeys]));
  }

  const remaining = await db
    .select({ preferenceKey: userPreferences.preferenceKey })
    .from(userPreferences)
    .where(inArray(userPreferences.preferenceKey, [...legacyKeys]));
  if (apply && remaining.length) {
    throw new Error(
      "A limpeza das preferências profissionais legadas não foi concluída."
    );
  }

  console.log(
    JSON.stringify({
      event: apply
        ? "professional.persistence.legacy_retirement.applied"
        : "professional.persistence.legacy_retirement.verified",
      apply,
      scannedPreferences: migration.scannedPreferences,
      migratedProfiles: migration.migratedProfiles,
      migratedAuthorizations: migration.migratedAuthorizations,
      legacyRowsBeforeCleanup: rows.length,
      legacyRowsRemaining: remaining.length,
    })
  );
}

void main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(
      JSON.stringify({
        event: "professional.persistence.legacy_retirement.failed",
        error: error instanceof Error ? error.message : "UnknownError",
      })
    );
    process.exit(1);
  });
