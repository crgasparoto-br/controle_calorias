import "dotenv/config";
import { inArray } from "drizzle-orm";
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
  legacyAccessToCanonical,
  parseLegacyProfessionalAccesses,
  parseLegacyProfessionalProfile,
  type CanonicalProfessionalAuthorization,
  type LegacyProfessionalAccess,
} from "../server/modules/professionals/persistence";
import { migrateAllLegacyProfessionalData } from "../server/modules/professionals/persistenceService";

const legacyKeys = [
  PROFESSIONAL_PROFILE_PREFERENCE_KEY,
  PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
  PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
] as const;

function sameInstant(left: Date | string | number, right: Date | string | number) {
  return new Date(left).getTime() === new Date(right).getTime();
}

function authorizationStatusCovers(
  canonical: CanonicalProfessionalAuthorization["status"],
  legacy: CanonicalProfessionalAuthorization["status"]
) {
  if (canonical === legacy) return true;
  if (legacy === "pending") return true;
  if (legacy === "approved") return canonical === "revoked";
  return false;
}

function authorizationIsCovered(
  canonical: CanonicalProfessionalAuthorization,
  legacy: LegacyProfessionalAccess
) {
  const expected = legacyAccessToCanonical(legacy);
  return (
    canonical.id === expected.id &&
    canonical.professionalUserId === expected.professionalUserId &&
    canonical.patientUserId === expected.patientUserId &&
    sameInstant(canonical.requestedAt, expected.requestedAt) &&
    canonical.sourceUpdatedAt.getTime() >= expected.sourceUpdatedAt.getTime() &&
    authorizationStatusCovers(canonical.status, expected.status)
  );
}

async function verifyCanonicalCoverage(db: any, rows: any[]) {
  const staleOrMissingProfiles: number[] = [];
  const expectedAuthorizations = new Map<string, LegacyProfessionalAccess>();
  let invalidPreferences = 0;

  for (const row of rows) {
    if (row.preferenceKey === PROFESSIONAL_PROFILE_PREFERENCE_KEY) {
      const sourceUpdatedAt = new Date(
        row.updatedAt ?? row.createdAt ?? Date.now()
      );
      const parsed = parseLegacyProfessionalProfile(
        row.userId,
        row.preferenceValue,
        sourceUpdatedAt
      );
      if (!parsed.value) {
        invalidPreferences += 1;
        continue;
      }
      const [profile] = await db
        .select({
          userId: professionalProfiles.userId,
          displayName: professionalProfiles.displayName,
          registrationNumber: professionalProfiles.registrationNumber,
          active: professionalProfiles.active,
          sourceUpdatedAt: professionalProfiles.sourceUpdatedAt,
        })
        .from(professionalProfiles)
        .where(inArray(professionalProfiles.userId, [row.userId]))
        .limit(1);
      const canonicalIsNewer =
        profile &&
        new Date(profile.sourceUpdatedAt).getTime() > sourceUpdatedAt.getTime();
      const sameVersionMatches =
        profile &&
        new Date(profile.sourceUpdatedAt).getTime() === sourceUpdatedAt.getTime() &&
        profile.displayName === parsed.value.displayName &&
        (profile.registrationNumber ?? undefined) ===
          parsed.value.registrationNumber &&
        profile.active === parsed.value.active;
      if (!canonicalIsNewer && !sameVersionMatches) {
        staleOrMissingProfiles.push(row.userId);
      }
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
    for (const access of parsed.value) {
      const previous = expectedAuthorizations.get(access.id);
      if (
        !previous ||
        legacyAccessToCanonical(previous).sourceUpdatedAt.getTime() <
          legacyAccessToCanonical(access).sourceUpdatedAt.getTime()
      ) {
        expectedAuthorizations.set(access.id, access);
      }
    }
  }

  const ids = [...expectedAuthorizations.keys()];
  const canonicalById = new Map<string, CanonicalProfessionalAuthorization>();
  if (ids.length) {
    const authorizations = await db
      .select()
      .from(professionalPatientAuthorizations)
      .where(inArray(professionalPatientAuthorizations.id, ids));
    for (const authorization of authorizations) {
      canonicalById.set(authorization.id, authorization);
    }
  }
  const staleOrMissingAuthorizations = ids.filter(id => {
    const canonical = canonicalById.get(id);
    const legacy = expectedAuthorizations.get(id);
    return !canonical || !legacy || !authorizationIsCovered(canonical, legacy);
  });

  return {
    invalidPreferences,
    staleOrMissingProfiles,
    staleOrMissingAuthorizations,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const db = await getDb();
  if (!db) {
    throw new Error(
      "DATABASE_URL indisponível para aposentar a persistência legada profissional."
    );
  }

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
    verification.staleOrMissingProfiles.length ||
    verification.staleOrMissingAuthorizations.length
  ) {
    throw new Error(
      `A cobertura canônica está incompleta: perfis=${verification.staleOrMissingProfiles.length}, autorizações=${verification.staleOrMissingAuthorizations.length}.`
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
