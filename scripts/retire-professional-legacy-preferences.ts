import "dotenv/config";
import { inArray } from "drizzle-orm";
import {
  professionalGoalSuggestions,
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
import { migrateAllLegacyProfessionalGoalSuggestions } from "../server/modules/professionals/contentPersistenceService";
import {
  normalizeLegacyGoalSuggestion,
  PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY,
  type ProfessionalGoalSuggestion,
} from "../server/repositories/professionalContentRepository";
import { migrateAllLegacyProfessionalData } from "../server/modules/professionals/persistenceService";

const legacyKeys = [
  PROFESSIONAL_PROFILE_PREFERENCE_KEY,
  PROFESSIONAL_ACCESSES_PREFERENCE_KEY,
  PATIENT_ACCESS_REQUESTS_PREFERENCE_KEY,
  PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY,
] as const;

function sameInstant(
  left: Date | string | number,
  right: Date | string | number
) {
  return new Date(left).getTime() === new Date(right).getTime();
}

function sameNullableInstant(
  left: Date | string | number | null,
  right: Date | string | number | null
) {
  if (left === null || right === null) return left === right;
  return sameInstant(left, right);
}

function canonicalInstantPreserves(
  canonical: Date | string | number | null,
  legacy: Date | string | number | null
) {
  if (legacy === null) return true;
  return (
    canonical !== null &&
    new Date(canonical).getTime() >= new Date(legacy).getTime()
  );
}

function sameGoal(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function nullableInstantValue(value: Date | string | number | null) {
  return value === null ? null : new Date(value).getTime();
}

function legacyAuthorizationSignature(access: LegacyProfessionalAccess) {
  const value = legacyAccessToCanonical(access);
  return JSON.stringify({
    id: value.id,
    professionalUserId: value.professionalUserId,
    patientUserId: value.patientUserId,
    status: value.status,
    reason: value.reason,
    requestedAt: value.requestedAt.getTime(),
    approvedAt: nullableInstantValue(value.approvedAt),
    rejectedAt: nullableInstantValue(value.rejectedAt),
    revokedAt: nullableInstantValue(value.revokedAt),
    respondedAt: nullableInstantValue(value.respondedAt),
    responseOrigin: value.responseOrigin,
    responseDecision: value.responseDecision,
    authorizationMessageStatus: value.authorizationMessageStatus,
    authorizationMessageSentAt: nullableInstantValue(
      value.authorizationMessageSentAt
    ),
    authorizationMessageError: value.authorizationMessageError,
    sourceUpdatedAt: value.sourceUpdatedAt.getTime(),
  });
}

function legacyGoalSuggestionSignature(
  suggestion: NonNullable<ReturnType<typeof normalizeLegacyGoalSuggestion>>
) {
  return JSON.stringify({
    id: suggestion.id,
    professionalUserId: suggestion.professionalUserId,
    patientUserId: suggestion.patientUserId,
    rationale: suggestion.rationale,
    status: suggestion.status,
    goal: suggestion.goal,
    createdAt: suggestion.createdAt,
    sentAt: suggestion.sentAt,
    respondedAt: suggestion.respondedAt,
  });
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
  const sameVersion =
    canonical.sourceUpdatedAt.getTime() === expected.sourceUpdatedAt.getTime();
  const immutableFieldsMatch =
    canonical.id === expected.id &&
    canonical.professionalUserId === expected.professionalUserId &&
    canonical.patientUserId === expected.patientUserId &&
    canonical.reason === expected.reason &&
    sameInstant(canonical.requestedAt, expected.requestedAt);
  if (!immutableFieldsMatch) return false;
  if (
    canonical.sourceUpdatedAt.getTime() < expected.sourceUpdatedAt.getTime()
  ) {
    return false;
  }
  if (!authorizationStatusCovers(canonical.status, expected.status))
    return false;

  if (sameVersion) {
    return (
      canonical.status === expected.status &&
      sameNullableInstant(canonical.approvedAt, expected.approvedAt) &&
      sameNullableInstant(canonical.rejectedAt, expected.rejectedAt) &&
      sameNullableInstant(canonical.revokedAt, expected.revokedAt) &&
      sameNullableInstant(canonical.respondedAt, expected.respondedAt) &&
      canonical.responseOrigin === expected.responseOrigin &&
      canonical.responseDecision === expected.responseDecision &&
      canonical.authorizationMessageStatus ===
        expected.authorizationMessageStatus &&
      sameNullableInstant(
        canonical.authorizationMessageSentAt,
        expected.authorizationMessageSentAt
      ) &&
      canonical.authorizationMessageError === expected.authorizationMessageError
    );
  }

  const lifecycleIsCovered =
    canonical.status === expected.status
      ? sameNullableInstant(canonical.approvedAt, expected.approvedAt) &&
        sameNullableInstant(canonical.rejectedAt, expected.rejectedAt) &&
        sameNullableInstant(canonical.revokedAt, expected.revokedAt) &&
        sameNullableInstant(canonical.respondedAt, expected.respondedAt) &&
        canonical.responseOrigin === expected.responseOrigin &&
        canonical.responseDecision === expected.responseDecision
      : canonicalInstantPreserves(canonical.approvedAt, expected.approvedAt) &&
        canonicalInstantPreserves(canonical.rejectedAt, expected.rejectedAt) &&
        canonicalInstantPreserves(canonical.revokedAt, expected.revokedAt) &&
        canonicalInstantPreserves(
          canonical.respondedAt,
          expected.respondedAt
        ) &&
        (expected.responseDecision === null ||
          (canonical.responseDecision !== null &&
            canonical.responseOrigin !== null));
  const messageStateIsCovered =
    canonical.authorizationMessageStatus === expected.authorizationMessageStatus
      ? sameNullableInstant(
          canonical.authorizationMessageSentAt,
          expected.authorizationMessageSentAt
        ) &&
        canonical.authorizationMessageError ===
          expected.authorizationMessageError
      : (expected.authorizationMessageStatus === null ||
          canonical.authorizationMessageStatus !== null) &&
        canonicalInstantPreserves(
          canonical.authorizationMessageSentAt,
          expected.authorizationMessageSentAt
        ) &&
        (expected.authorizationMessageStatus !== "failed" ||
          canonical.authorizationMessageStatus !== "failed" ||
          canonical.authorizationMessageError !== null);

  return lifecycleIsCovered && messageStateIsCovered;
}

function goalSuggestionStatusCovers(
  canonical: ProfessionalGoalSuggestion["status"],
  legacy: ProfessionalGoalSuggestion["status"]
) {
  if (canonical === legacy) return true;
  if (legacy === "draft") return true;
  if (legacy === "sent") {
    return ["accepted", "refused", "cancelled"].includes(canonical);
  }
  return false;
}

function goalSuggestionIsCovered(
  canonical: ProfessionalGoalSuggestion,
  legacy: NonNullable<ReturnType<typeof normalizeLegacyGoalSuggestion>>
) {
  return (
    canonical.id === legacy.id &&
    canonical.professionalUserId === legacy.professionalUserId &&
    canonical.patientUserId === legacy.patientUserId &&
    canonical.rationale === legacy.rationale &&
    sameGoal(canonical.goal, legacy.goal) &&
    canonical.createdAt === legacy.createdAt &&
    goalSuggestionStatusCovers(canonical.status, legacy.status) &&
    (legacy.sentAt === null ||
      (canonical.sentAt !== null && canonical.sentAt >= legacy.sentAt)) &&
    (legacy.respondedAt === null ||
      (canonical.respondedAt !== null &&
        canonical.respondedAt >= legacy.respondedAt)) &&
    canonical.updatedAt >=
      Math.max(
        legacy.createdAt ?? 0,
        legacy.sentAt ?? 0,
        legacy.respondedAt ?? 0
      )
  );
}

async function verifyCanonicalCoverage(db: any, rows: any[]) {
  const staleOrMissingProfiles: number[] = [];
  const expectedAuthorizations = new Map<string, LegacyProfessionalAccess>();
  const expectedGoalSuggestions = new Map<
    string,
    NonNullable<ReturnType<typeof normalizeLegacyGoalSuggestion>>
  >();
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
        new Date(profile.sourceUpdatedAt).getTime() ===
          sourceUpdatedAt.getTime() &&
        profile.displayName === parsed.value.displayName &&
        (profile.registrationNumber ?? undefined) ===
          parsed.value.registrationNumber &&
        profile.active === parsed.value.active;
      if (!canonicalIsNewer && !sameVersionMatches) {
        staleOrMissingProfiles.push(row.userId);
      }
      continue;
    }

    if (row.preferenceKey === PATIENT_GOAL_SUGGESTIONS_PREFERENCE_KEY) {
      let parsedGoalSuggestions: unknown;
      try {
        parsedGoalSuggestions = JSON.parse(row.preferenceValue);
      } catch {
        invalidPreferences += 1;
        continue;
      }
      if (!Array.isArray(parsedGoalSuggestions)) {
        invalidPreferences += 1;
        continue;
      }
      for (const item of parsedGoalSuggestions) {
        const normalized = normalizeLegacyGoalSuggestion(row.userId, item);
        if (!normalized) {
          invalidPreferences += 1;
          continue;
        }
        const previous = expectedGoalSuggestions.get(normalized.id);
        const normalizedVersion = Math.max(
          normalized.createdAt ?? 0,
          normalized.sentAt ?? 0,
          normalized.respondedAt ?? 0
        );
        const previousVersion = previous
          ? Math.max(
              previous.createdAt ?? 0,
              previous.sentAt ?? 0,
              previous.respondedAt ?? 0
            )
          : -1;
        if (!previous || previousVersion < normalizedVersion) {
          expectedGoalSuggestions.set(normalized.id, normalized);
        } else if (
          previousVersion === normalizedVersion &&
          legacyGoalSuggestionSignature(previous) !==
            legacyGoalSuggestionSignature(normalized)
        ) {
          invalidPreferences += 1;
        }
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
      const previousVersion = previous
        ? legacyAccessToCanonical(previous).sourceUpdatedAt.getTime()
        : -1;

      const accessVersion =
        legacyAccessToCanonical(access).sourceUpdatedAt.getTime();

      if (!previous || previousVersion < accessVersion) {
        expectedAuthorizations.set(access.id, access);
      } else if (
        previousVersion === accessVersion &&
        legacyAuthorizationSignature(previous) !==
          legacyAuthorizationSignature(access)
      ) {
        invalidPreferences += 1;
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

  const goalSuggestionIds = [...expectedGoalSuggestions.keys()];
  const canonicalGoalSuggestions = new Map<
    string,
    ProfessionalGoalSuggestion
  >();
  if (goalSuggestionIds.length) {
    const suggestions = await db
      .select()
      .from(professionalGoalSuggestions)
      .where(inArray(professionalGoalSuggestions.id, goalSuggestionIds));
    for (const suggestion of suggestions) {
      canonicalGoalSuggestions.set(suggestion.id, {
        id: suggestion.id,
        professionalUserId: suggestion.professionalUserId,
        patientUserId: suggestion.patientUserId,
        rationale: suggestion.rationale,
        status: suggestion.status,
        goal: suggestion.goal as ProfessionalGoalSuggestion["goal"],
        version: suggestion.version,
        createdAt: suggestion.createdAt.getTime(),
        sentAt: suggestion.sentAt?.getTime() ?? null,
        respondedAt: suggestion.respondedAt?.getTime() ?? null,
        updatedAt: suggestion.updatedAt.getTime(),
      });
    }
  }
  const staleOrMissingGoalSuggestions = goalSuggestionIds.filter(id => {
    const canonical = canonicalGoalSuggestions.get(id);
    const legacy = expectedGoalSuggestions.get(id);
    return !canonical || !legacy || !goalSuggestionIsCovered(canonical, legacy);
  });

  return {
    invalidPreferences,
    staleOrMissingProfiles,
    staleOrMissingAuthorizations,
    staleOrMissingGoalSuggestions,
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
  const goalSuggestionMigration =
    await migrateAllLegacyProfessionalGoalSuggestions();
  const rows = await db
    .select()
    .from(userPreferences)
    .where(inArray(userPreferences.preferenceKey, [...legacyKeys]));
  const verification = await verifyCanonicalCoverage(db, rows);

  if (
    migration.invalidPreferences > 0 ||
    goalSuggestionMigration.invalid > 0 ||
    verification.invalidPreferences > 0
  ) {
    throw new Error(
      "Existem preferências profissionais legadas inválidas; nenhuma exclusão foi executada."
    );
  }
  if (
    verification.staleOrMissingProfiles.length ||
    verification.staleOrMissingAuthorizations.length ||
    verification.staleOrMissingGoalSuggestions.length
  ) {
    throw new Error(
      `A cobertura canônica está incompleta: perfis=${verification.staleOrMissingProfiles.length}, autorizações=${verification.staleOrMissingAuthorizations.length}, sugestões=${verification.staleOrMissingGoalSuggestions.length}.`
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
      invalidPreferences: migration.invalidPreferences,
      scannedGoalSuggestionPreferences:
        goalSuggestionMigration.scannedPreferences,
      migratedGoalSuggestions: goalSuggestionMigration.migrated,
      invalidGoalSuggestionPreferences: goalSuggestionMigration.invalid,
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
